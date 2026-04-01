// 22-language i18n for Onda
export const LANGS = [
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'th', name: 'ภาษาไทย', flag: '🇹🇭' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
  { code: 'bn', name: 'বাংলা', flag: '🇧🇩' },
  { code: 'ur', name: 'اردو', flag: '🇵🇰' },
  { code: 'ne', name: 'नेपाली', flag: '🇳🇵' },
  { code: 'mn', name: 'Монгол', flag: '🇲🇳' },
  { code: 'fa', name: 'فارسی', flag: '🇮🇷' },
  { code: 'tl', name: 'Filipino', flag: '🇵🇭' },
  { code: 'my', name: 'မြန်မာ', flag: '🇲🇲' },
] as const;

export type LangCode = typeof LANGS[number]['code'];

type Strings = typeof ko;

const ko = {
  // Landing
  heroTitle: '온다',
  heroSub: '긴급한 순간,\n가장 가까운 검증된 사람이 달려옵니다',
  heroCta: '긴급 돌봄 요청하기',
  howTitle: '어떻게 작동하나요?',
  step1: '요청', step1d: '긴급 상황 발생 시 한 번 탭으로 돌봄 요청',
  step2: '매칭', step2d: '반경 3km 내 검증된 출동자에게 즉시 전달',
  step3: '출동', step3d: '가장 가까운 출동자가 현장으로 달려갑니다',
  responderCta: '출동자로 참여하세요',
  responderCtaSub: '검증된 시민으로 등록하고, 긴급 돌봄이 필요한 이웃을 도우며 보상을 받으세요.',
  responderBtn: '출동자 등록하기',
  // Nav
  login: '로그인',
  logout: '로그아웃',
  // Login
  loginTitle: '온다',
  loginSub: '긴급 돌봄 O2O 플랫폼',
  kakaoLogin: '카카오로 시작하기',
  googleLogin: 'Google로 시작하기',
  termsAgree: '가입 시 이용약관 및 개인정보처리방침에 동의합니다.',
  // Requester
  hello: '님, 안녕하세요',
  sosLabel: '긴급 돌봄 요청',
  sosSub: '긴급 돌봄이 필요하면 아래 버튼을 눌러주세요.',
  recentRequests: '최근 요청',
  noRequests: '아직 요청이 없습니다',
  // Create request
  createTitle: '긴급 돌봄 요청',
  typeLabel: '돌봄 유형',
  typeChild: '아이 돌봄',
  typeElder: '어르신 돌봄',
  typeDisabled: '장애인 돌봄',
  typeOther: '기타',
  addressLabel: '주소',
  addressPlaceholder: '출동 장소 주소 입력',
  descLabel: '상황 설명',
  descPlaceholder: '어떤 상황인지 간단히 알려주세요',
  urgencyLabel: '긴급도',
  urgencyNormal: '일반',
  urgencyUrgent: '긴급',
  urgencyEmergency: '응급',
  submitRequest: '출동 요청하기',
  submitting: '요청 중...',
  // Status
  statusTitle: '요청 상태',
  stepMatching: '매칭중',
  stepAccepted: '수락',
  stepMoving: '이동중',
  stepArrived: '도착',
  stepCaring: '돌봄중',
  stepDone: '완료',
  searching: '주변 출동자를 찾고 있습니다...',
  // Responder
  responderTitle: '출동자',
  done: '건',
  availOn: '대기 ON',
  availOff: '대기 OFF',
  needRegister: '출동자 등록이 필요합니다',
  needRegisterSub: '출동자로 활동하려면 먼저 등록해주세요.',
  registerBtn: '출동자 등록하기',
  pendingApproval: '승인 대기 중',
  pendingApprovalSub: '관리자가 검토 후 승인합니다. 잠시만 기다려주세요.',
  incomingRequests: '수신된 요청',
  waitingRequests: '요청을 기다리는 중...',
  turnOnToReceive: '대기를 켜면 요청을 받을 수 있습니다',
  accept: '수락',
  reject: '거절',
  // Match detail
  matchTitle: '출동 상세',
  startMoving: '이동 시작',
  arrivedBtn: '도착 완료',
  startCare: '돌봄 시작',
  completeCare: '돌봄 완료',
  careInProgress: '돌봄 진행 중',
  careCompleted: '돌봄 완료',
  noAddress: '주소 정보 없음',
  // Admin
  adminTitle: '관리자 대시보드',
  tabStats: '통계',
  tabResponders: '출동자 승인',
  tabRequests: '요청 현황',
  tabSettlements: '정산',
  totalUsers: '전체 사용자',
  approvedResponders: '승인 출동자',
  pendingResponders: '승인 대기',
  requestsToday: '오늘 요청',
  completedToday: '오늘 완료',
  noPending: '승인 대기 중인 출동자가 없습니다',
  approve: '승인',
  suspend: '거절',
  noSettlements: '정산 대기 건이 없습니다',
  payBtn: '정산 처리',
  fee: '수수료',
  total: '총액',
  managing: '담당',
};

const en: Strings = {
  heroTitle: 'Onda',
  heroSub: 'In an emergency,\nthe nearest verified helper rushes to you',
  heroCta: 'Request Emergency Care',
  howTitle: 'How does it work?',
  step1: 'Request', step1d: 'One tap to request care in an emergency',
  step2: 'Match', step2d: 'Instantly sent to verified helpers within 3km',
  step3: 'Dispatch', step3d: 'The nearest helper rushes to the scene',
  responderCta: 'Become a Helper',
  responderCtaSub: 'Register as a verified citizen, help neighbors in need, and earn rewards.',
  responderBtn: 'Register as Helper',
  login: 'Sign In', logout: 'Sign Out',
  loginTitle: 'Onda', loginSub: 'Emergency Care O2O Platform',
  kakaoLogin: 'Continue with Kakao', googleLogin: 'Continue with Google',
  termsAgree: 'By signing up you agree to our Terms and Privacy Policy.',
  hello: ', Hello', sosLabel: 'Emergency Care', sosSub: 'Press the button below if you need urgent care.',
  recentRequests: 'Recent Requests', noRequests: 'No requests yet',
  createTitle: 'Emergency Care Request',
  typeLabel: 'Care Type', typeChild: 'Child Care', typeElder: 'Elder Care', typeDisabled: 'Disability Care', typeOther: 'Other',
  addressLabel: 'Address', addressPlaceholder: 'Enter dispatch address',
  descLabel: 'Description', descPlaceholder: 'Briefly describe the situation',
  urgencyLabel: 'Urgency', urgencyNormal: 'Normal', urgencyUrgent: 'Urgent', urgencyEmergency: 'Emergency',
  submitRequest: 'Request Dispatch', submitting: 'Requesting...',
  statusTitle: 'Request Status',
  stepMatching: 'Matching', stepAccepted: 'Accepted', stepMoving: 'En Route', stepArrived: 'Arrived', stepCaring: 'Caring', stepDone: 'Done',
  searching: 'Searching for nearby helpers...',
  responderTitle: 'Helper', done: 'done', availOn: 'Available', availOff: 'Offline',
  needRegister: 'Registration Required', needRegisterSub: 'Register to start helping.',
  registerBtn: 'Register as Helper', pendingApproval: 'Pending Approval', pendingApprovalSub: 'Admin will review and approve. Please wait.',
  incomingRequests: 'Incoming Requests', waitingRequests: 'Waiting for requests...', turnOnToReceive: 'Turn on availability to receive requests',
  accept: 'Accept', reject: 'Decline',
  matchTitle: 'Dispatch Detail',
  startMoving: 'Start Moving', arrivedBtn: 'Mark Arrived', startCare: 'Start Care', completeCare: 'Complete Care',
  careInProgress: 'Care in Progress', careCompleted: 'Care Completed', noAddress: 'No address',
  adminTitle: 'Admin Dashboard',
  tabStats: 'Stats', tabResponders: 'Approval', tabRequests: 'Requests', tabSettlements: 'Settlements',
  totalUsers: 'Total Users', approvedResponders: 'Approved Helpers', pendingResponders: 'Pending',
  requestsToday: 'Today Requests', completedToday: 'Completed Today',
  noPending: 'No pending helpers', approve: 'Approve', suspend: 'Reject',
  noSettlements: 'No pending settlements', payBtn: 'Process Payment', fee: 'Fee', total: 'Total', managing: 'managing',
};

const ja: Strings = {
  heroTitle: 'オンダ', heroSub: '緊急時に、\n最も近い検証された人が駆けつけます',
  heroCta: '緊急ケアを依頼', howTitle: 'どのように動作しますか?',
  step1: '依頼', step1d: 'ワンタップで緊急ケアを依頼', step2: 'マッチング', step2d: '3km圏内の検証済みヘルパーに即座に通知',
  step3: '出動', step3d: '最寄りのヘルパーが現場に急行',
  responderCta: 'ヘルパーとして参加', responderCtaSub: '検証された市民として登録し、支援が必要な人を助けて報酬を得ましょう。',
  responderBtn: 'ヘルパー登録', login: 'ログイン', logout: 'ログアウト',
  loginTitle: 'オンダ', loginSub: '緊急ケアO2Oプラットフォーム',
  kakaoLogin: 'カカオで続ける', googleLogin: 'Googleで続ける',
  termsAgree: '登録により利用規約とプライバシーポリシーに同意します。',
  hello: 'さん、こんにちは', sosLabel: '緊急ケア', sosSub: '緊急時は下のボタンを押してください。',
  recentRequests: '最近の依頼', noRequests: 'まだ依頼がありません',
  createTitle: '緊急ケア依頼', typeLabel: 'ケアタイプ', typeChild: '子どもケア', typeElder: '高齢者ケア', typeDisabled: '障がい者ケア', typeOther: 'その他',
  addressLabel: '住所', addressPlaceholder: '出動先の住所を入力', descLabel: '状況説明', descPlaceholder: '状況を簡単に説明してください',
  urgencyLabel: '緊急度', urgencyNormal: '通常', urgencyUrgent: '緊急', urgencyEmergency: '救急',
  submitRequest: '出動依頼', submitting: '依頼中...',
  statusTitle: '依頼状況', stepMatching: 'マッチング', stepAccepted: '受諾', stepMoving: '移動中', stepArrived: '到着', stepCaring: 'ケア中', stepDone: '完了',
  searching: '近くのヘルパーを探しています...',
  responderTitle: 'ヘルパー', done: '件', availOn: '待機ON', availOff: '待機OFF',
  needRegister: '登録が必要です', needRegisterSub: 'ヘルパーとして活動するには登録してください。',
  registerBtn: 'ヘルパー登録', pendingApproval: '承認待ち', pendingApprovalSub: '管理者が確認後承認します。',
  incomingRequests: '受信した依頼', waitingRequests: '依頼待ち...', turnOnToReceive: '待機をONにすると依頼を受けられます',
  accept: '受諾', reject: '辞退',
  matchTitle: '出動詳細', startMoving: '移動開始', arrivedBtn: '到着完了', startCare: 'ケア開始', completeCare: 'ケア完了',
  careInProgress: 'ケア中', careCompleted: 'ケア完了', noAddress: '住所なし',
  adminTitle: '管理者ダッシュボード', tabStats: '統計', tabResponders: '承認', tabRequests: '依頼', tabSettlements: '精算',
  totalUsers: '全ユーザー', approvedResponders: '承認ヘルパー', pendingResponders: '承認待ち',
  requestsToday: '本日の依頼', completedToday: '本日完了',
  noPending: '承認待ちなし', approve: '承認', suspend: '拒否',
  noSettlements: '精算待ちなし', payBtn: '精算処理', fee: '手数料', total: '合計', managing: '担当',
};

// For other languages, fall back to English with key overrides
const zhOverrides: Partial<Strings> = {
  heroTitle: '温达', heroSub: '紧急时刻，\n最近的认证人员赶来帮助', heroCta: '请求紧急护理',
  login: '登录', logout: '退出', kakaoLogin: '使用Kakao继续', googleLogin: '使用Google继续',
  sosLabel: '紧急护理', submitRequest: '请求出动', accept: '接受', reject: '拒绝',
};
const viOverrides: Partial<Strings> = {
  heroTitle: 'Onda', heroSub: 'Trong trường hợp khẩn cấp,\nngười giúp đỡ gần nhất sẽ đến ngay',
  login: 'Đăng nhập', logout: 'Đăng xuất', sosLabel: 'Chăm sóc khẩn cấp',
};
const thOverrides: Partial<Strings> = {
  heroTitle: 'อนดา', heroSub: 'ในกรณีฉุกเฉิน\nผู้ช่วยที่ใกล้ที่สุดจะรีบมาหาคุณ',
  login: 'เข้าสู่ระบบ', logout: 'ออกจากระบบ',
};

function merge(base: Strings, overrides: Partial<Strings>): Strings {
  return { ...base, ...overrides } as Strings;
}

const translations: Record<string, Strings> = {
  ko, en, ja,
  zh: merge(en, zhOverrides),
  vi: merge(en, viOverrides),
  th: merge(en, thOverrides),
};

export function detectLang(): LangCode {
  const saved = localStorage.getItem('onda_lang');
  if (saved && translations[saved]) return saved as LangCode;
  const bl = (navigator.language || '').slice(0, 2);
  return translations[bl] ? bl as LangCode : 'ko';
}

export function setLang(code: LangCode) {
  localStorage.setItem('onda_lang', code);
  document.documentElement.lang = code;
}

export function t(key: keyof Strings, lang?: LangCode): string {
  const l = lang || detectLang();
  const dict = translations[l] || translations.en || ko;
  return dict[key] || ko[key] || key;
}

export function useLang(): { lang: LangCode; t: (key: keyof Strings) => string; setLang: (code: LangCode) => void } {
  // Simple hook — reads from localStorage
  const lang = detectLang();
  return {
    lang,
    t: (key: keyof Strings) => t(key, lang),
    setLang: (code: LangCode) => { setLang(code); window.location.reload(); },
  };
}
