import { serverCall, GAS_URL, DEFAULT_GAS_URL } from './api.js';

/**
 * State Management
 */
let state = {
    isLoggedIn: false,
    config: {},
    customers: [],
    tab: 'dashboard',
    dashRangeMonths: 6,
    listRangeMonths: 6,
    listCardCols: localStorage.getItem('listCardCols') || 'auto',
    listGroupBy: localStorage.getItem('listGroupBy') || 'none',
    activeListFilter: null,
    carryPeriod: null,
    editing: null,
    isCreate: false,
    calDate: new Date()
};

/**
 * DOM Utils
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || '').replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const todayYMD = () => new Date().toISOString().slice(0, 10);
const parseYMD = (s) => { const t = String(s || '').trim(); if (!t) return null; const d = new Date(t); return isNaN(d) ? null : d; };

/**
 * Money Formatting
 */
const _digitsOnly = (v) => String(v || '').replace(/[^0-9]/g, '');
const formatMoneyValue = (v) => {
    const d = _digitsOnly(v);
    if (!d) return '';
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

function formatMoneyInput(el) { el.value = formatMoneyValue(el.value); }

function bindMoneyInputs() {
    document.querySelectorAll('.money-input').forEach(input => {
        if (input.dataset.moneyBound === '1') return;
        input.dataset.moneyBound = '1';
        input.addEventListener('input', () => formatMoneyInput(input));
        input.addEventListener('blur', () => formatMoneyInput(input));
    });
}

function formatAllMoneyInputs() {
    document.querySelectorAll('.money-input').forEach(input => formatMoneyInput(input));
}

function fmtMoney(v) {
    const n = Number(String(v || '').replace(/,/g, '').trim());
    if (!n || isNaN(n)) return '';
    return n.toLocaleString('ko-KR');
}

function toNumber(v) {
    const n = Number(String(v || '').replace(/,/g, '').trim());
    return isFinite(n) ? n : 0;
}

/**
 * UI State Utils
 */
function busy(on, text) {
    const el = $('busy');
    const t = $('busyText');
    if (text) t.innerText = text;
    if (on) {
        el.classList.remove('hidden');
        el.classList.add('flex');
    } else {
        el.classList.add('hidden');
        el.classList.remove('flex');
    }
}

/**
 * Business Logic (Migrated from original)
 */
const isSub = (c) => String(c.payMethod || '') === '구독(할부)';
const isEsignDone = (c) => String(c.esignStatus || '') === '서명완료';
const isCancelled = (c) => String(c.esignStatus || '') === '계약취소' || String(c.kccDepositStatus || '') === '계약취소';
const isConstructionDone = (c) => {
    if (!isEsignDone(c)) return false;
    const d = parseYMD(c.constructDateFix);
    if (!d) return false;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return d < now;
};
const isContractComplete = (c) => {
    if (!isEsignDone(c)) return false;
    if (isCancelled(c)) return false;
    if (isConstructionDone(c)) return false;
    return String(c.constructConfirm || '') === '완료';
};
const isContractInProgress = (c) => {
    if (!isEsignDone(c)) return false;
    if (isCancelled(c)) return false;
    if (isConstructionDone(c)) return false;
    const v = String(c.constructConfirm || '').trim();
    return (v === '대기' || v === '');
};
const isUnordered = (c) => {
    if (isCancelled(c)) return false;
    if (!isEsignDone(c)) return false;
    return String(c.kccDepositStatus || '') !== '입금완료';
};
const isCashDepositMissing = (c) => {
    if (isSub(c)) return false;
    if (isCancelled(c)) return false;
    return isEsignDone(c) && !String(c.paidDate || '').trim();
};
const isCashBalanceMissing_Done = (c) => {
    if (isCancelled(c)) return false;
    if (isSub(c)) return false;
    if (!isEsignDone(c)) return false;
    const bal = toNumber(c.balanceAmount);
    if (!bal) return false;
    return !String(c.balancePaidDate || '').trim();
};
const isConstructionUnconfirmed = (c) => {
    if (isCancelled(c)) return false;
    const hf = String(c.hankaeFeedback || '');
    if (hf.includes('불가')) return false;
    return String(c.constructConfirm || '') !== '완료';
};
const isEsignNotApproved = (c) => {
    if (isCancelled(c)) return false;
    return String(c.esignStatus || '') === '발송완료';
};
const isHankaeWait = (c) => {
    if (isCancelled(c)) return false;
    if (!isSub(c)) return false;
    if (String(c.subApprove || '') !== '승인') return false;
    return String(c.hankaeFeedback || '') !== '진행';
};
const isInstallmentIncomplete = (c) => {
    if (!isSub(c)) return false;
    if (String(c.hankaeFeedback || '') !== '진행') return false;
    return !String(c.recordingRequestDate || '').trim();
};

/**
 * filtering
 */
function filterByPeriod(list, mode, year, month, rangeMonths) {
    if (mode === 'all') return list.slice();
    if (mode === 'year') {
        return list.filter(c => c.regDate && c.regDate.startsWith(String(year)));
    }
    if (mode === 'month') {
        const ym = `${year}-${month}`;
        return list.filter(c => c.regDate && c.regDate.startsWith(ym));
    }
    const n = Number(rangeMonths || 0);
    if (!n) return list.slice();
    const d = new Date(); d.setMonth(d.getMonth() - n); d.setHours(0, 0, 0, 0);
    return list.filter(c => {
        const cd = parseYMD(c.regDate);
        return cd && cd >= d;
    });
}

/**
 * Authentication
 */
async function login() {
    const gasUrl = ($('gasUrl').value.trim()) || DEFAULT_GAS_URL;
    const pw = $('pw').value;

    if (!gasUrl) return alert('GAS Web App URL을 입력해주세요.');
    if (!pw) return alert('Passcode를 입력해주세요.');

    $('loginMsg').innerText = '';
    $('loginBusy').classList.remove('hidden');

    try {
        const res = await serverCall('checkLogin', { gasUrl, passcode: pw });
        if (res && res.ok) {
            localStorage.setItem('GAS_URL', gasUrl);
            localStorage.setItem('kcc_passcode', pw);
            localStorage.setItem('kcc_auth_ts', Date.now());

            $('login').classList.add('hidden');
            $('app').classList.remove('hidden');
            state.isLoggedIn = true;
            await reloadAll(true);
            switchTab('dashboard', false);
        } else {
            $('loginMsg').innerText = res.msg || '로그인 실패';
        }
    } catch (e) {
        $('loginMsg').innerText = e.message;
    } finally {
        $('loginBusy').classList.add('hidden');
    }
}

/**
 * Data Management
 */
async function reloadAll(initial) {
    if (initial) { state.activeListFilter = null; state.carryPeriod = null; }
    try {
        const res = await serverCall('getInitialData');
        state.config = res.config || {};
        state.customers = (res.data && res.data.customers) ? res.data.customers : [];
        renderBanners();
        initSelectors();
        if (initial) {
            $('dashMode').value = 'range'; state.dashRangeMonths = 6;
            $('listMode').value = 'range'; state.listRangeMonths = 6;
        }
        renderDashboardInteractive();
        renderList();
        if (state.tab === 'calendar') renderCalendar();
    } catch (err) {
        alert('데이터 연동 오류: ' + err.message);
    }
}

function initSelectors() {
    const years = Array.from(new Set(state.customers.map(c => String(c.regDate || '').slice(0, 4)).filter(Boolean))).sort();
    const nowY = String(new Date().getFullYear());
    if (!years.includes(nowY)) years.push(nowY);
    years.sort();

    fillSelect('dashYear', years);
    fillSelect('listYear', years);

    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    fillSelect('dashMonth', months);
    fillSelect('listMonth', months);

    $('dashYear').value = nowY;
    $('listYear').value = nowY;
    $('dashMonth').value = String(new Date().getMonth() + 1).padStart(2, '0');
    $('listMonth').value = String(new Date().getMonth() + 1).padStart(2, '0');

    // filters
    fillSelect('fBranch', state.config.branches || [], '지점 전체');
    fillSelect('fChannel', state.config.inflowChannels || [], '유입채널 전체');
    fillSelect('fPay', state.config.payMethods || [], '결제방법 전체');
    fillSelect('fEsign', state.config.esignStatusList || [], '전자서명 전체');
    fillSelect('fSubApprove', state.config.subApproveList || [], '구독승인 전체');
    fillSelect('fHankae', state.config.hankaeFeedbackList || [], '한캐피드백 전체');

    // modal
    fillSelect('f-branch', state.config.branches || [], '(미선택)');
    fillSelect('f-inflowChannel', state.config.inflowChannels || [], '(미선택)');
    fillSelect('f-constructConfirm', state.config.constructConfirmList || [], '(미선택)');
    fillSelect('f-esignStatus', state.config.esignStatusList || [], '(미선택)');
    fillSelect('f-payMethod', state.config.payMethods || [], '(미선택)');
    fillSelect('f-subApprove', state.config.subApproveList || [], '(미선택)');
    fillSelect('f-hankaeFeedback', state.config.hankaeFeedbackList || [], '(미선택)');
    fillSelect('f-plusProduct', state.config.plusProducts || [], '(미선택)');
}

function fillSelect(id, arr, placeholder) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = '';
    if (placeholder) {
        const o = document.createElement('option');
        o.value = ''; o.textContent = placeholder;
        el.appendChild(o);
    }
    arr.forEach(v => {
        if (v === '' || v == null) return;
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = String(v);
        el.appendChild(o);
    });
}

/**
 * Navigation
 */
function switchTab(tab, shouldReload = true, fromDashboard = false) {
    state.tab = tab;
    $('topTitle').innerText = tab === 'dashboard' ? '대시보드' : tab === 'list' ? '고객리스트' : '시공달력';
    $('topSub').innerText = tab === 'dashboard' ? '최근 6개월 데이터 기준 실적 분석' : '전체 계약 고객 현황 관리';

    document.querySelectorAll('.navBtn').forEach(b => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('bg-white/10', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('shadow-lg', active);
    });

    ['dashboard', 'list', 'calendar'].forEach(t => {
        const sec = $('page-' + t);
        if (sec) sec.classList.toggle('hidden', t !== tab);
    });

    if (tab === 'list' && !fromDashboard) {
        state.activeListFilter = null;
        state.carryPeriod = null;
    }

    if (shouldReload && state.isLoggedIn) {
        reloadAll(false);
    }

    if (tab === 'calendar') renderCalendar();
}

/**
 * Dashboard Rendering
 */
function renderDashboardInteractive() {
    const mode = $('dashMode').value;
    const year = $('dashYear').value;
    const month = $('dashMonth').value;
    const range = (mode === 'range') ? state.dashRangeMonths : 0;
    const base = filterByPeriod(state.customers, mode, year, month, range);

    const signed = base.filter(isEsignDone);
    const doneList = signed.filter(isConstructionDone);
    const completeList = signed.filter(isContractComplete);
    const progressList = signed.filter(isContractInProgress);
    const cancelList = base.filter(isCancelled);

    // Performance Cards
    const perfData = [
        { label: '총 등록', key: 'total', val: base.length, cash: base.filter(c => !isSub(c)).length, sub: base.filter(isSub).length, tone: 'text-slate-900', icon: 'fa-folder-plus' },
        { label: '공사완료', key: 'done', val: doneList.length, cash: doneList.filter(c => !isSub(c)).length, sub: doneList.filter(isSub).length, tone: 'text-indigo-600', icon: 'fa-check-double' },
        { label: '계약완료', key: 'complete', val: completeList.length, cash: completeList.filter(c => !isSub(c)).length, sub: completeList.filter(isSub).length, tone: 'text-emerald-500', icon: 'fa-circle-check' },
        { label: '계약진행', key: 'progress', val: progressList.length, cash: progressList.filter(c => !isSub(c)).length, sub: progressList.filter(isSub).length, tone: 'text-amber-500', icon: 'fa-spinner' },
        { label: '계약취소', key: 'cancel', val: cancelList.length, cash: cancelList.filter(c => !isSub(c)).length, sub: cancelList.filter(isSub).length, tone: 'text-rose-500', icon: 'fa-ban' }
    ];

    $('dashPerf').innerHTML = perfData.map(d => `
    <div class="premium-card bg-white p-6 rounded-3xl shadow-sm cursor-pointer group" onclick="onDashPerfClick('${d.key}', 'all')">
      <div class="flex items-start justify-between">
        <div class="space-y-1">
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${d.label}</div>
          <div class="text-3xl font-black ${d.tone}">${d.val}</div>
        </div>
        <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-all">
          <i class="fas ${d.icon} text-lg"></i>
        </div>
      </div>
      <div class="mt-4 flex gap-4 border-t border-slate-50 pt-4">
        <div class="flex-1">
          <div class="text-[9px] font-black text-slate-400 uppercase tracking-tighter">CASH</div>
          <div class="text-xs font-bold text-slate-600">${d.cash}</div>
        </div>
        <div class="flex-1">
          <div class="text-[9px] font-black text-slate-400 uppercase tracking-tighter">SUBS</div>
          <div class="text-xs font-bold text-slate-600">${d.sub}</div>
        </div>
      </div>
    </div>
  `).join('');

    // Revenue Cards
    const sumFinal = (list) => list.reduce((a, c) => a + toNumber(c.finalQuote), 0);
    const salesData = [
        { label: '총 매출', val: sumFinal(base), cash: sumFinal(base.filter(c => !isSub(c))), sub: sumFinal(base.filter(isSub)), tone: 'text-slate-900' },
        { label: '공사 매출', val: sumFinal(doneList), cash: sumFinal(doneList.filter(c => !isSub(c))), sub: sumFinal(doneList.filter(isSub)), tone: 'text-indigo-600' },
        { label: '계약 매출', val: sumFinal(completeList), cash: sumFinal(completeList.filter(c => !isSub(c))), sub: sumFinal(completeList.filter(isSub)), tone: 'text-emerald-500' },
        { label: '예정 매출', val: sumFinal(progressList), cash: sumFinal(progressList.filter(c => !isSub(c))), sub: sumFinal(progressList.filter(isSub)), tone: 'text-amber-500' }
    ];

    $('dashSales').innerHTML = salesData.map(d => `
    <div class="premium-card bg-white p-6 rounded-3xl shadow-sm">
      <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">${d.label}</div>
      <div class="text-xl font-black ${d.tone}">₩ ${fmtMoney(d.val)}</div>
      <div class="mt-4 grid grid-cols-2 gap-2 border-t border-slate-50 pt-4">
        <div>
          <span class="text-[9px] font-black text-slate-400 block uppercase">Cash</span>
          <span class="text-[11px] font-bold text-slate-600">${fmtMoney(d.cash)}</span>
        </div>
        <div>
          <span class="text-[9px] font-black text-slate-400 block uppercase">Subs</span>
          <span class="text-[11px] font-bold text-slate-600">${fmtMoney(d.sub)}</span>
        </div>
      </div>
    </div>
  `).join('');

    renderDashTasks(base);
    renderDashTimeline();
}

/**
 * Task Management
 */
function renderDashTasks(base) {
    const tasks = [
        { key: 'balance_missing', title: '잔금 확인', count: base.filter(isCashBalanceMissing_Done).length, tone: 'text-rose-400', bg: 'bg-rose-500/10' },
        { key: 'deposit_missing', title: '입금 누락', count: base.filter(isCashDepositMissing).length, tone: 'text-amber-400', bg: 'bg-amber-500/10' },
        { key: 'unordered', title: '미발주 현황', count: base.filter(isUnordered).length, tone: 'text-indigo-400', bg: 'bg-indigo-500/10' },
        { key: 'construct_unconfirmed', title: '시공 미확정', count: base.filter(isConstructionUnconfirmed).length, tone: 'text-slate-400', bg: 'bg-slate-500/10' }
    ];

    $('dashTasks').innerHTML = tasks.map(t => `
    <div class="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all cursor-pointer group" onclick="onDashTaskClick('${t.key}')">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg ${t.bg} flex items-center justify-center ${t.tone}">
          <i class="fas fa-exclamation-triangle text-xs"></i>
        </div>
        <span class="text-sm font-bold text-white/90 group-hover:text-white transition-all">${t.title}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xl font-black text-white">${t.count}</span>
        <i class="fas fa-chevron-right text-[10px] text-white/20 group-hover:translate-x-1 transition-all"></i>
      </div>
    </div>
  `).join('');
}

function renderDashTimeline() {
    const now = new Date();
    const months = [
        new Date(now.getFullYear(), now.getMonth() - 1, 1),
        new Date(now.getFullYear(), now.getMonth(), 1),
        new Date(now.getFullYear(), now.getMonth() + 1, 1)
    ];
    const ids = ['mPrev', 'mCur', 'mNext'];
    const labels = ['mPrevT', 'mCurT', 'mNextT'];

    months.forEach((d, i) => {
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        $(labels[i]).innerText = `${d.getFullYear()}.${d.getMonth() + 1}`;

        const items = state.customers
            .filter(c => String(c.constructDateFix || '').startsWith(ym))
            .sort((a, b) => String(a.constructDateFix).localeCompare(b.constructDateFix))
            .slice(0, 5);

        $(ids[i]).innerHTML = items.length ? items.map(c => `
      <div class="p-3 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all cursor-pointer group" onclick="openModalByNo('${c.customerNo}')">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-black text-slate-800">${esc(c.name)}</span>
          <span class="text-[10px] font-black text-indigo-500">${String(c.constructDateFix).slice(8, 10)}일</span>
        </div>
        <div class="text-[10px] text-slate-400 font-bold truncate">${esc(c.address)}</div>
      </div>
    `).join('') : '<div class="h-full flex flex-col items-center justify-center opacity-30 py-8"><i class="fas fa-calendar-xmark text-2xl mb-2"></i><span class="text-[10px] font-black">일정 없음</span></div>';
    });
}

/**
 * List Rendering
 */
function renderList() {
    const mode = $('listMode').value;
    const year = $('listYear').value;
    const month = $('listMonth').value;
    const range = (mode === 'range') ? state.listRangeMonths : 0;

    let list = filterByPeriod(state.customers, mode, year, month, range);

    // Custom logic for filtering/grouping goes here...
    // (Simplified for this example, same as original code logic)

    const q = String($('q').value || '').toLowerCase();
    if (q) {
        list = list.filter(c =>
            String(c.name || '').toLowerCase().includes(q) ||
            String(c.phone || '').includes(q) ||
            String(c.customerNo || '').toLowerCase().includes(q) ||
            String(c.address || '').toLowerCase().includes(q)
        );
    }

    $('cnt').innerText = list.length;

    const wrap = $('cards');
    wrap.className = `grid gap-6 ${state.listCardCols === '1' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`;

    wrap.innerHTML = list.length ? list.map(c => renderCard(c)).join('') : `
    <div class="col-span-full py-20 bg-white rounded-[32px] border border-slate-100 flex flex-col items-center justify-center opacity-40">
      <i class="fas fa-users-slash text-5xl mb-4"></i>
      <p class="font-black">검색 결과가 없습니다</p>
    </div>
  `;
}

function renderCard(c) {
    const isS = isSub(c);
    return `
    <div class="premium-card bg-white p-6 rounded-[32px] shadow-sm hover:ring-2 hover:ring-indigo-600/10 cursor-pointer animate-fade-in" onclick="openModalByNo('${c.customerNo}')">
      <div class="flex items-start justify-between">
        <div class="space-y-2">
          <div class="flex items-center gap-3">
            <h4 class="text-lg font-black text-slate-900">${esc(c.name)}</h4>
            <span class="px-3 py-1 bg-slate-100 rounded-lg text-[10px] font-black text-slate-500 uppercase tracking-widest">${esc(c.customerNo)}</span>
          </div>
          <div class="flex items-center gap-4 text-xs font-bold text-slate-400">
            <span><i class="fas fa-phone mr-1.5 opacity-50"></i>${esc(c.phone)}</span>
            <span><i class="fas fa-location-dot mr-1.5 opacity-50"></i>${esc(c.address.slice(0, 20))}...</span>
          </div>
        </div>
        <div class="text-right">
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Final Quote</div>
          <div class="text-lg font-black text-indigo-600">₩ ${fmtMoney(c.finalQuote)}</div>
        </div>
      </div>
      
      <div class="mt-6 flex flex-wrap gap-2">
        <span class="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${isS ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}">${isS ? 'SUBSCRIPTION' : 'CASH'}</span>
        <span class="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-50 text-slate-500">${esc(c.branch || '미지정')}</span>
        ${c.constructDateFix ? `<span class="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-amber-50 text-amber-600"><i class="far fa-calendar-check mr-2"></i>${c.constructDateFix}</span>` : ''}
      </div>
    </div>
  `;
}

/**
 * Modal Handling
 */
async function openModalByNo(no) {
    const c = state.customers.find(x => x.customerNo === no);
    if (!c) return alert('고객을 찾을 수 없습니다.');

    state.editing = { ...c };
    state.isCreate = false;

    $('modal').classList.remove('hidden');
    $('modal').classList.add('flex');
    showModalLoading(true);

    // Fill Modal Fields (Simulated)
    $('mTitle').innerText = c.name || '신규 고객';
    $('mCustomerNo').innerText = c.customerNo || '자동 생성 예정';
    $('mHeaderPhone').innerText = c.phone || '-';
    $('mHeaderAddress').innerText = c.address || '-';

    // Delay for smooth UI
    setTimeout(() => {
        fillModalFields(c);
        showModalLoading(false);
        switchModalTab('basic');
    }, 100);
}

function fillModalFields(c) {
    const fields = ['customerNo', 'branch', 'regDate', 'inflowChannel', 'name', 'phone', 'address', 'memoQuick',
        'constructConfirm', 'constructDateFix', 'esignStatus', 'payMethod', 'finalQuote', 'plusYn',
        'paidAmount', 'paidDate', 'balanceAmount', 'balancePaidDate',
        'interestYn', 'subTotalFee', 'subMonths', 'subMonthlyFee', 'subApprove',
        'hankaeFeedback', 'installmentContractDate', 'recordingRequestDate',
        'plusProduct', 'plusModel', 'deliveryDate', 'memo'];

    fields.forEach(f => {
        const el = $('f-' + f);
        if (!el) return;
        let v = c[f] || '';
        if (['finalQuote', 'paidAmount', 'balanceAmount', 'subTotalFee', 'subMonthlyFee'].includes(f)) {
            v = fmtMoney(v);
        }
        el.value = v;
    });
    formatAllMoneyInputs();
}

function switchModalTab(tab) {
    document.querySelectorAll('.mtab').forEach(b => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('text-indigo-600', active);
        b.classList.toggle('border-b-4', active);
        b.classList.toggle('border-indigo-600', active);
        b.classList.toggle('text-slate-400', !active);
    });

    document.querySelectorAll('.msec').forEach(s => {
        s.classList.toggle('hidden', s.dataset.tab !== tab);
    });
}

function showModalLoading(on) {
    $('modalLoading').classList.toggle('hidden', !on);
    $('modalLoading').classList.add(on ? 'flex' : 'hidden');
}

/**
 * Event Listeners
 */
document.addEventListener('DOMContentLoaded', () => {
    $('btnLogin').addEventListener('click', login);
    $('btnLogout').addEventListener('click', () => { localStorage.clear(); location.reload(); });

    document.querySelectorAll('.navBtn').forEach(b => {
        b.addEventListener('click', () => switchTab(b.dataset.tab));
    });

    $('dashMode').addEventListener('change', renderDashboardInteractive);
    $('listMode').addEventListener('change', renderList);
    $('q').addEventListener('input', renderList);

    $('btnAdd').addEventListener('click', () => {
        openModalByNo(''); // Logic for new customer
    });

    $('btnClose').addEventListener('click', () => $('modal').classList.add('hidden'));
    $('btnSave').addEventListener('click', () => alert('저장 기능은 GAS 연동 후 활성화됩니다.'));

    document.querySelectorAll('.mtab').forEach(b => {
        b.addEventListener('click', () => switchModalTab(b.dataset.tab));
    });

    // Pre-fill GAS URL
    if ($('gasUrl')) {
        $('gasUrl').value = localStorage.getItem('GAS_URL') || DEFAULT_GAS_URL;
    }

    // Check Session
    const ts = localStorage.getItem('kcc_auth_ts');
    if (ts && (Date.now() - ts < 3 * 60 * 60 * 1000)) {
        $('login').classList.add('hidden');
        $('app').classList.remove('hidden');
        state.isLoggedIn = true;
        reloadAll(true);
    }
});

function renderBanners() { /* Banners sync */ }
function renderCalendar() { /* Calendar logic */ }
function onDashPerfClick(key, pay) { /* Dashboard interaction */ }
function onDashTaskClick(key) { /* Task interaction */ }
