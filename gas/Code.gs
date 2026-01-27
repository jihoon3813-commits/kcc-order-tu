/**
 * KCC 관리자 (Netlify 배포용 API)
 * 기존 Code.gs의 로직을 유지하면서, 외부에서의 fetch() 요청을 처리하도록 doPost/doGet을 수정했습니다.
 */

function doGet() {
  return createResponse_({ ok: true, msg: 'KCC API is running.' });
}

const SPREADSHEET_ID = '1N_Y6op2Nail3oHfsdZIdPza2ZmDd8oV1qS44LqxEXSU';
const SHEET_CONTRACT = '계약현황';
const SHEET_CONFIG   = 'config';

const FIELD_MAP = {
  no: 'No.',
  branch: '지점',
  customerNo: '고객번호',
  applyDate: '신청일',
  regDate: '등록일',
  inflowChannel: '유입채널',
  name: '고객명',
  phone: '연락처',
  address: '주소',
  constructConfirm: '시공확정여부',
  constructDateFix: '확정시공일',
  payMethod: '결제방법',
  finalQuote: '최종견적가',
  plusYn: 'PLUS 가전 여부',
  esignStatus: '시공계약서(전자서명)',
  esignDate: '전자서명일',
  kccSupplyPrice: 'KCC공급가',
  kccDepositStatus: 'KCC입금여부',
  paidAmount: '입금/결제금액',
  paidDate: '입금/결제일',
  balanceAmount: '잔금',
  balancePaidDate: '잔금 결제일',
  birth: '생년월일',
  interestYn: '이자유무',
  subTotalFee: '총구독료',
  subMonths: '구독개월',
  subMonthlyFee: '월구독료',
  subApprove: '승인여부',
  hankaeFeedback: '한캐피드백',
  installmentContractDate: '할부계약일',
  recordingRequestDate: '녹취요청',
  plusProduct: '제품명',
  plusModel: '모델명',
  deliveryDate: '배송일',
  memo: '비고'
};

/**
 * 외부 fetch() 요청을 위한 doPost
 */
function doPost(e) {
  let result;
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    const payload = params.payload;

    // 인증 체크
    if (action !== 'checkLogin') {
      const authOk = verifyAuth_(params.passcode);
      if (!authOk) {
        return createResponse_({ ok: false, msg: '인증에 실패했습니다.' });
      }
    }

    switch (action) {
      case 'checkLogin':
        result = checkLogin(params.passcode);
        break;
      case 'getInitialData':
        result = getInitialData();
        break;
      case 'createCustomer':
        result = createCustomer(payload);
        break;
      case 'updateCustomer':
        result = updateCustomer(payload);
        break;
      case 'deleteCustomer':
        result = deleteCustomer(payload.customerNo);
        break;
      default:
        result = { ok: false, msg: '알 수 없는 액션' };
    }
  } catch (err) {
    result = { ok: false, msg: err.toString() };
  }

  return createResponse_(result);
}

/**
 * CORS 및 JSON 응답 생성
 */
function createResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyAuth_(passcode) {
  const p = String(passcode || '').trim();
  if (p === 'xldb@@') return true; // 새 비밀번호 무조건 허용
  const stored = PropertiesService.getScriptProperties().getProperty('KCC_PASSCODE') || 'xldb@@';
  return p === String(stored).trim();
}

function checkLogin(passcode) {
  const ok = verifyAuth_(passcode);
  if (ok) return { ok: true };
  return { ok: false, msg: '비밀번호가 올바르지 않습니다.' };
}

function getInitialData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(SHEET_CONTRACT);
  if (!sh) throw new Error('계약현황 시트를 찾을 수 없습니다.');

  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return { config: getConfig_(), data: { customers: [] } };
  }

  const headers = values[0].map(v => String(v).trim());
  const idx = makeIndex_(headers);

  const requiredKey = idx[FIELD_MAP.customerNo];
  if (requiredKey == null) throw new Error('계약현황 시트에 "고객번호" 컬럼이 필요합니다.');

  const customers = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.join('').trim() === '') continue;

    const obj = {};
    Object.keys(FIELD_MAP).forEach(k => {
      const colName = FIELD_MAP[k];
      const c = idx[colName];
      obj[k] = c != null ? normalizeCell_(row[c]) : '';
    });

    if (!obj.inflowChannel) {
      const eIdx = idx['유입채널'];
      obj.inflowChannel = (eIdx != null) ? normalizeCell_(row[eIdx]) : normalizeCell_(row[4] || '');
    }

    if (!obj.plusYn) {
      const pIdx = idx['PLUS 가전 여부'];
      obj.plusYn = (pIdx != null) ? normalizeCell_(row[pIdx]) : normalizeCell_(row[13] || '');
    }
    obj.plusProduct = obj.plusYn;
    obj._rowNumber = r + 1;
    if (!obj.customerNo) obj.customerNo = makeCustomerNo_();
    if (!obj.regDate && obj.applyDate) obj.regDate = obj.applyDate;

    customers.push(obj);
  }

  return { config: getConfig_(), data: { customers } };
}

function createCustomer(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_CONTRACT);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
  const idx = makeIndex_(headers);

  const row = new Array(headers.length).fill('');
  const customerNo = String(payload.customerNo || '').trim() || makeCustomerNo_();
  const normalized = Object.assign({}, payload, { customerNo });

  if (!normalized.regDate && normalized.applyDate) normalized.regDate = normalized.applyDate;

  Object.keys(FIELD_MAP).forEach(k => {
    const colName = FIELD_MAP[k];
    const c = idx[colName];
    if (c == null) return;
    row[c] = normalized[k] != null ? normalized[k] : '';
  });

  sh.appendRow(row);
  return { ok: true, customerNo };
}

function updateCustomer(payload) {
  const customerNo = String(payload.customerNo || '').trim();
  if (!customerNo) throw new Error('customerNo(고객번호)가 없습니다.');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_CONTRACT);
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(v => String(v).trim());
  const idx = makeIndex_(headers);

  const keyCol = idx[FIELD_MAP.customerNo];
  if (keyCol == null) throw new Error('계약현황 시트에 "고객번호" 컬럼이 필요합니다.');

  let rowNo = -1;
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][keyCol]).trim() === customerNo) { rowNo = r + 1; break; }
  }
  if (rowNo < 0) throw new Error('해당 고객번호를 찾을 수 없습니다.');

  if (!payload.regDate && payload.applyDate) payload.regDate = payload.applyDate;

  Object.keys(FIELD_MAP).forEach(k => {
    if (!(k in payload)) return;
    const colName = FIELD_MAP[k];
    const c = idx[colName];
    if (c == null) return;
    sh.getRange(rowNo, c + 1).setValue(payload[k]);
  });

  return { ok: true };
}

function deleteCustomer(customerNo) {
  const key = String(customerNo || '').trim();
  if (!key) throw new Error('customerNo가 없습니다.');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_CONTRACT);
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(v => String(v).trim());
  const idx = makeIndex_(headers);

  const keyCol = idx[FIELD_MAP.customerNo];

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][keyCol]).trim() === key) {
      sh.deleteRow(r + 1);
      return { ok: true };
    }
  }
  throw new Error('삭제할 대상을 찾을 수 없습니다.');
}

function getConfig_() {
  const base = {
    branches: ['종합','인천','수원'],
    esignStatusList: ['진행대기','발송완료','서명완료','계약취소'],
    constructConfirmList: ['대기','완료','취소','한캐불가'],
    kccDepositStatusList: ['입금대기','입금완료','계약취소'],
    subApproveList: ['대기','승인','정밀','불가'],
    hankaeFeedbackList: ['대기','진행','불가'],
    payMethods: ['현금','카드','카드+현금','구독(할부)','현금+구독','카드+구독','50/50(현금)','50/50(카드)'],
    inflowChannels: [],
    plusProducts: [],
    banners: []
  };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh) return base;

  const rows = sh.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i][0] || '').trim();
    const v = rows[i][1];
    if (!k) continue;

    const s = String(v || '').trim();
    try { out[k] = JSON.parse(s); }
    catch(e) { out[k] = s; }
  }

  return Object.assign(base, out);
}

function makeIndex_(headers) {
  const idx = {};
  headers.forEach((h, i) => idx[String(h).trim()] = i);
  return idx;
}

function normalizeCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  return v == null ? '' : String(v).trim();
}

function makeCustomerNo_() {
  const now = new Date();
  const ymd = Utilities.formatDate(now, 'Asia/Seoul', 'yyyyMMdd-HHmmss');
  const rnd = Math.random().toString(36).slice(2,6).toUpperCase();
  return `C-${ymd}-${rnd}`;
}
