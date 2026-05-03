export const VERSION = '0503-17';

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
  P4: { warnLow:12, probLow:5 },   // X-Factor (ﾂｰ): lower = worse
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
  address:'繧｢繝峨Ξ繧ｹ', backswing:'繝・う繧ｯ繝舌ャ繧ｯ',
  top:'繝医ャ繝・, downswing:'繧､繝ｳ繝代け繝・, follow:'繝輔か繝ｭ繝ｼ',
};

export const ADVICE = {
  P1:{
    label:'鬆ｭ驛ｨ縺ｮ螳牙ｮ・,
    ok:'鬆ｭ驛ｨ縺ｯ螳牙ｮ壹＠縺ｦ縺・∪縺吶・,
    warn:'鬆ｭ驛ｨ縺後ｄ繧・ｧｻ蜍輔＠縺ｦ縺・∪縺吶・,
    problem:'鬆ｭ驛ｨ縺後う繝ｳ繝代け繝域凾縺ｫ螟ｧ縺阪￥遘ｻ蜍輔＠縺ｦ縺・∪縺吶・,
    hint:'蜿ｳ閠ｳ縺ｮ菴咲ｽｮ繧偵う繝ｳ繝代け繝医∪縺ｧ繧ｭ繝ｼ繝励＠縺ｾ縺励ｇ縺・ゅ・繝ｼ繝ｫ縺ｮ髻ｳ縺瑚◇縺薙∴繧九∪縺ｧ鬘斐ｒ荳翫￡縺ｪ縺・う繝｡繝ｼ繧ｸ縺梧怏蜉ｹ縺ｧ縺吶・,
  },
  P2:{
    label:'繝ｩ繝・Λ繝ｫ繧ｹ繧ｦ繧ｧ繧､',
    ok:'繝・う繧ｯ繝舌ャ繧ｯ縺ｧ閻ｰ縺ｯ螳牙ｮ壹＠縺ｦ縺・∪縺吶・,
    warn:'繝・う繧ｯ繝舌ャ繧ｯ縺ｧ繧・ｄ閻ｰ縺梧ｨｪ縺ｫ豬√ｌ縺ｦ縺・∪縺吶・,
    problem:'繝・う繧ｯ繝舌ャ繧ｯ縺ｧ閻ｰ縺悟､ｧ縺阪￥讓ｪ遘ｻ蜍輔＠縺ｦ縺・∪縺呻ｼ医Λ繝・Λ繝ｫ繧ｹ繧ｦ繧ｧ繧､・峨・,
    hint:'蜿ｳ縺ｲ縺悶・隗貞ｺｦ繧貞､峨∴縺壹↓菴薙ｒ蝗櫁ｻ｢縺輔○縺ｾ縺励ｇ縺・ょ承雜ｳ縺ｮ蜀・・縺ｧ蝨ｰ髱｢繧定ｸ上∩縺ｨ縺ｩ縺ｾ繧九う繝｡繝ｼ繧ｸ縺ｧ縲・,
  },
  P3:{
    label:'閼頑浤隗貞ｺｦ',
    ok:'蜑榊だ隗偵・邯ｭ謖√〒縺阪※縺・∪縺吶・,
    warn:'繝繧ｦ繝ｳ繧ｹ繧､繝ｳ繧ｰ縺ｧ繧・ｄ菴薙′襍ｷ縺堺ｸ翫′縺｣縺ｦ縺・∪縺吶・,
    problem:'繝繧ｦ繝ｳ繧ｹ繧､繝ｳ繧ｰ縺ｧ菴薙′襍ｷ縺堺ｸ翫′縺｣縺ｦ縺・∪縺呻ｼ医い繝ｼ繝ｪ繝ｼ繧ｨ繧ｯ繧ｹ繝・Φ繧ｷ繝ｧ繝ｳ・峨・,
    hint:'繧｢繝峨Ξ繧ｹ縺ｮ蜑榊だ隗偵ｒ菫昴▲縺溘∪縺ｾ謖ｯ繧頑栢縺阪∪縺励ｇ縺・ゅ♀蟆ｻ縺ｮ菴咲ｽｮ繧偵い繝峨Ξ繧ｹ縺ｮ縺ｾ縺ｾ蝗ｺ螳壹☆繧九う繝｡繝ｼ繧ｸ繧呈戟縺｣縺ｦ縺上□縺輔＞縲・,
  },
  P4:{
    label:'X-繝輔ぃ繧ｯ繧ｿ繝ｼ',
    ok:'繝医ャ繝励〒蜊∝・縺ｪ閧ｩ閻ｰ縺ｮ謐ｻ霆｢蟾ｮ縺後≠繧翫∪縺吶・,
    warn:'繝医ャ繝励〒閧ｩ縺ｨ閻ｰ縺ｮ謐ｻ霆｢蟾ｮ縺後ｄ繧・ｸ崎ｶｳ縺励※縺・∪縺吶・,
    problem:'繝医ャ繝励〒閧ｩ縺ｨ閻ｰ縺ｮ謐ｻ霆｢蟾ｮ縺御ｸ崎ｶｳ縺励※縺・∪縺呻ｼ・-繝輔ぃ繧ｯ繧ｿ繝ｼ荳崎ｶｳ・峨・,
    hint:'縲瑚・45ﾂｰ繝ｻ閧ｩ90ﾂｰ縲阪・繧､繝｡繝ｼ繧ｸ縺ｧ繝・う繧ｯ繝舌ャ繧ｯ縺励∪縺励ｇ縺・ょｷｦ閧ｩ繧偵い繧ｴ縺ｮ荳九∪縺ｧ蝗槭＠縺ｪ縺後ｉ蜿ｳ縺ｲ縺悶・隗貞ｺｦ繧剃ｿ昴▲縺ｦ閻ｰ縺ｮ蝗櫁ｻ｢繧呈椛縺医ｋ縺ｮ縺後・繧､繝ｳ繝医〒縺吶・,
  },
  P6:{
    label:'繧ｭ繝阪・繝・ぅ繝・け繧ｷ繝ｼ繧ｱ繝ｳ繧ｹ',
    ok:'繝繧ｦ繝ｳ繧ｹ繧､繝ｳ繧ｰ縺ｧ閻ｰ竊定か縺ｮ豁｣縺励＞騾｣骼夜°蜍輔′縺ｧ縺阪※縺・∪縺吶・,
    warn:'繝繧ｦ繝ｳ繧ｹ繧､繝ｳ繧ｰ縺ｧ閻ｰ縺ｨ閧ｩ縺後⊇縺ｼ蜷梧凾縺ｫ蜍輔＞縺ｦ縺翫ｊ縲・｣骼悶′荳肴・迸ｭ縺ｧ縺吶・,
    problem:'繝繧ｦ繝ｳ繧ｹ繧､繝ｳ繧ｰ縺ｧ閧ｩ縺瑚・繧医ｊ蜈医↓蜍輔＞縺ｦ縺・∪縺呻ｼ医い繝ｼ繝繝峨せ繧､繝ｳ繧ｰ・峨・,
    hint:'蛻・ｊ霑斐＠逶ｴ蠕後↓蟾ｦ閻ｰ繧堤岼讓呎婿蜷代∈蜈医↓蜍輔°縺励√◎縺ｮ蠕後↓閧ｩ繝ｻ閻輔′霑ｽ縺・°縺代ｋ繧､繝｡繝ｼ繧ｸ繧呈戟縺｡縺ｾ縺励ｇ縺・ゅ瑚・縺九ｉ蛻・ｋ縲肴э隴倥′繧ｨ繝阪Ν繧ｮ繝ｼ縺ｮ騾｣骼悶ｒ逕溘∩縺ｾ縺吶・,
  },
  P9:{
    label:'繝輔か繝ｭ繝ｼ繝舌Λ繝ｳ繧ｹ',
    ok:'繝輔ぅ繝九ャ繧ｷ繝･縺ｮ繝舌Λ繝ｳ繧ｹ縺ｯ濶ｯ螂ｽ縺ｧ縺吶・,
    warn:'繝輔ぅ繝九ャ繧ｷ繝･縺ｧ菴馴㍾遘ｻ蜍輔′繧・ｄ荳榊香蛻・〒縺吶・,
    problem:'繝輔ぅ繝九ャ繧ｷ繝･縺ｧ菴馴㍾縺悟ｷｦ雜ｳ縺ｫ遘ｻ繧翫″縺｣縺ｦ縺・∪縺帙ｓ縲・,
    hint:'繝輔ぅ繝九ャ繧ｷ繝･縺ｧ蜿ｳ雜ｳ縺ｮ縺九°縺ｨ繧呈ｵｮ縺九○縲∝ｷｦ雜ｳ荳譛ｬ縺ｧ3遘堤ｫ九※繧九ヰ繝ｩ繝ｳ繧ｹ繧堤岼謖・＠縺ｾ縺励ｇ縺・・,
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
  { id:'general',   label:'蜈ｨ闊ｬ' },
  { id:'slice',     label:'繧ｹ繝ｩ繧､繧ｹ' },
  { id:'distance',  label:'鬟幄ｷ晞屬' },
  { id:'direction', label:'譁ｹ蜷第ｧ' },
  { id:'topduff',   label:'繝医ャ繝・繝繝輔Μ' },
];
