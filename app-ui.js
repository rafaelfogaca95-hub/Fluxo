'use strict';

/* ============================================================
   Fluxo — interface
   ============================================================ */

const $ = function(id){ return document.getElementById(id); };
let toastTimer = null;
let deferredPrompt = null;

let attachTarget = null;    /* { txId } ou { pending: true } */
let pendingReceipts = [];   /* arquivos de um lançamento ainda não salvo */
let modalUrls = [];         /* object URLs para revogar ao fechar */
let modalPaid = false;
let modalDefer = false;
let viewerTxId = null;
let viewerUrls = [];
let cardViewMonth = null;   /* fatura em exibição na aba Cartão */
let cardEditMode = false;   /* formulário do cartão aberto */
let cardFormReady = false;  /* evita reescrever o formulário a cada render */

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  clip: '<path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.6l8.49-8.48"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>'
};

function icon(name, size){
  const s = size || 16;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
}

/* ---------- comprovantes: utilidades ---------- */

function recStore(){ return window.FluxoReceipts || null; }

function receiptsOf(txId){
  const r = recStore();
  return r ? r.list(txId) : [];
}

function receiptCount(txId){
  return receiptsOf(txId).length;
}

function isNativeApp(){
  return !!(window.FluxoNative && window.FluxoNative.isNative);
}

function fmtBytes(n){
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return (v / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB';
  if (v >= 1024) return Math.round(v / 1024) + ' KB';
  return Math.max(1, Math.round(v)) + ' B';
}

function blobToBase64(blob){
  return new Promise(function(resolve, reject){
    const reader = new FileReader();
    reader.onload = function(){
      const s = String(reader.result || '');
      resolve(s.indexOf('base64,') >= 0 ? s.split('base64,')[1] : '');
    };
    reader.onerror = function(){ reject(new Error('Não foi possível ler o arquivo.')); };
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 800);
}

function payLabel(t){
  if (t.type === 'income') return t.paid ? 'recebida' : 'a receber';
  return t.paid ? 'pago' : 'aberto';
}

function toast(msg){
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2400);
}

/* ---------- tema ---------- */

function isDark(){
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function applyTheme(){
  const pref = (state.settings && state.settings.theme) || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#121210' : '#0F7B5F');
  const btn = $('themeBtn');
  if (btn) btn.innerHTML = icon(dark ? 'sun' : 'moon', 17);
  if (window.FluxoNative && window.FluxoNative.isNative) {
    window.FluxoNative.setTheme(dark);
  }
}

function toggleTheme(){
  state.settings.theme = isDark() ? 'light' : 'dark';
  saveState();
  applyTheme();
}

/* ---------- selects ---------- */

function optionHtml(c){
  return '<option value="' + c.id + '">' + c.icon + ' ' + c.name + '</option>';
}

function fillTypeCategories(select, type, selected){
  const list = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  select.innerHTML = list.map(optionHtml).join('');
  const preferred = selected || (type === 'expense' ? 'alimentacao' : 'salario');
  if (list.some(function(c){ return c.id === preferred; })) select.value = preferred;
}

function fillAllCategories(select, includeAll){
  let html = includeAll ? '<option value="">Todas</option>' : '';
  html += '<optgroup label="Despesas">' + EXPENSE_CATS.map(optionHtml).join('') + '</optgroup>';
  html += '<optgroup label="Receitas">' + INCOME_CATS.map(optionHtml).join('') + '</optgroup>';
  select.innerHTML = html;
}

function fillStaticSelects(){
  fillAllCategories($('f-cat'), true);
  fillAllCategories($('r-cat'), false);
  $('m-method').innerHTML = METHODS.map(function(m){
    return '<option value="' + m + '">' + m + '</option>';
  }).join('');
  $('r-method').innerHTML = METHODS.map(function(m){
    return '<option value="' + m + '">' + m + '</option>';
  }).join('');
  let opts = '';
  for (let i = 1; i <= 12; i++) opts += '<option value="' + i + '">' + i + 'x</option>';
  if ($('m-installments')) $('m-installments').innerHTML = opts;
}

/* ---------- render: topo ---------- */

function renderMonthBar(){
  const s = statsFor(viewMonth);
  const ml = monthLong(viewMonth);
  $('monthLabel').textContent = ml.charAt(0).toUpperCase() + ml.slice(1);
  $('monthSub').textContent = s.count
    ? s.count + (s.count === 1 ? ' lançamento' : ' lançamentos')
    : 'sem lançamentos';
  const isCurrent = viewMonth === thisMonthKey();
  const btn = $('todayBtn');
  btn.classList.toggle('visible', !isCurrent);
  btn.disabled = isCurrent;
}

function renderKpis(){
  const s = statsFor(viewMonth);
  const prevKey = shiftMonth(viewMonth, -1);
  const prev = statsFor(prevKey);
  const incomeCount = s.tx.filter(function(t){ return t.type === 'income'; }).length;
  const expenseCount = s.tx.filter(function(t){ return t.type === 'expense'; }).length;

  const balanceEl = $('kpiBalance');
  balanceEl.className = 'kpi kpi-hero' + (s.balance < 0 ? ' neg' : '');
  balanceEl.innerHTML =
    '<span class="kpi-label">Sobrou no mês</span>' +
    '<span class="kpi-value">' + fmtBRL(s.balance) + '</span>' +
    '<span class="kpi-note">' + (s.count ? 'entradas − despesas de ' + monthShort(viewMonth) : 'Adicione seu primeiro lançamento') + '</span>';

  const incomeEl = $('kpiIncome');
  incomeEl.className = 'kpi positive';
  incomeEl.innerHTML =
    '<span class="kpi-label">Receitas</span>' +
    '<span class="kpi-value">' + fmtBRL(s.income) + '</span>' +
    '<span class="kpi-note">' + (incomeCount ? incomeCount + (incomeCount === 1 ? ' entrada' : ' entradas') : 'nenhuma entrada') + '</span>';

  let expenseNote = 'nenhuma despesa';
  if (s.expense > 0) {
    if (prev.expense > 0) {
      const delta = ((s.expense - prev.expense) / prev.expense) * 100;
      expenseNote = (delta <= 0 ? '▼ ' : '▲ ') + Math.abs(Math.round(delta)) + '% vs. ' + monthShort(prevKey);
    } else {
      expenseNote = expenseCount + (expenseCount === 1 ? ' despesa' : ' despesas');
    }
  }
  const expenseEl = $('kpiExpense');
  expenseEl.className = 'kpi negative';
  expenseEl.innerHTML =
    '<span class="kpi-label">Despesas</span>' +
    '<span class="kpi-value">' + fmtBRL(s.expense) + '</span>' +
    '<span class="kpi-note">' + expenseNote + '</span>';

  const rateEl = $('kpiRate');
  const aberto = Number(s.openExpense) || 0;
  const abertos = Number(s.openCount) || 0;
  rateEl.className = 'kpi ' + (aberto > 0 ? 'negative' : 'positive');
  rateEl.innerHTML =
    '<span class="kpi-label">Em aberto</span>' +
    '<span class="kpi-value">' + fmtBRL(aberto) + '</span>' +
    '<span class="kpi-note">' + (abertos > 0
      ? abertos + (abertos === 1 ? ' despesa a pagar' : ' despesas a pagar')
      : (s.expense > 0 ? 'tudo pago ✓' : 'nada a pagar')) + '</span>';
}

/* ---------- render: gráficos ---------- */

function renderDonut(){
  const map = expenseByCat(viewMonth);
  const total = Object.keys(map).reduce(function(sum, k){ return sum + map[k]; }, 0);
  const wrap = $('donut');
  const legend = $('donutLegend');

  if (!total) {
    wrap.innerHTML = '';
    legend.innerHTML = '<div class="empty" style="padding:18px 8px"><strong>Sem gastos neste mês</strong>Quando você lançar uma despesa, o gráfico mostra onde o dinheiro está indo.</div>';
    $('donutSub').textContent = '0 categorias';
    return;
  }

  const entries = Object.keys(map).map(function(id){
    const c = catById(id);
    return { id: id, name: c.name, color: c.color, val: map[id] };
  }).sort(function(a, b){ return b.val - a.val; });

  let shown = entries;
  if (entries.length > 6) {
    const rest = entries.slice(5);
    shown = entries.slice(0, 5).concat([{
      id: '_rest',
      name: 'Outras categorias',
      color: '#9C978B',
      val: rest.reduce(function(sum, e){ return sum + e.val; }, 0)
    }]);
  }

  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;
  let segs = '';
  shown.forEach(function(e){
    const len = (e.val / total) * C;
    segs += '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + e.color +
      '" stroke-width="20" stroke-dasharray="' + len + ' ' + (C - len) +
      '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 70 70)"></circle>';
    offset += len;
  });

  wrap.innerHTML =
    '<svg viewBox="0 0 140 140" class="donut-svg" role="img" aria-label="Distribuição dos gastos por categoria">' +
    '<circle cx="70" cy="70" r="54" fill="none" stroke="var(--track)" stroke-width="20"/>' +
    segs +
    '<text x="70" y="67" text-anchor="middle" class="donut-total">' + fmtCompact(total) + '</text>' +
    '<text x="70" y="85" text-anchor="middle" class="donut-sub">total gasto</text>' +
    '</svg>';

  legend.innerHTML = shown.map(function(e){
    const pct = Math.round((e.val / total) * 100);
    return '<div class="legend-row">' +
      '<span class="dot" style="background:' + e.color + '"></span>' +
      '<span class="legend-name">' + escapeHtml(e.name) + '</span>' +
      '<span class="legend-val">' + fmtBRL(e.val) + '</span>' +
      '<span class="legend-pct">' + pct + '%</span>' +
      '</div>';
  }).join('');

  $('donutSub').textContent = Object.keys(map).length + (Object.keys(map).length === 1 ? ' categoria' : ' categorias');
}

function renderTrend(){
  const p = viewMonth.split('-').map(Number);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(p[0], p[1] - 1 - i, 1);
    const key = monthKey(d);
    const s = statsFor(key);
    months.push({ key: key, label: MONTHS_SHORT[d.getMonth()], income: s.income, expense: s.expense });
  }
  const max = Math.max.apply(null, months.map(function(m){ return Math.max(m.income, m.expense); }).concat([1]));

  $('trend').innerHTML = months.map(function(m){
    const hIn = m.income > 0 ? Math.max(4, Math.round((m.income / max) * 100)) : 2;
    const hOut = m.expense > 0 ? Math.max(4, Math.round((m.expense / max) * 100)) : 2;
    return '<div class="trend-col" title="' + monthLong(m.key) + ': entradas ' + fmtBRL(m.income) + ' · saídas ' + fmtBRL(m.expense) + '">' +
      '<div class="trend-bars">' +
      '<div class="tbar tbar-in" style="height:' + hIn + '%"></div>' +
      '<div class="tbar tbar-out" style="height:' + hOut + '%"></div>' +
      '</div>' +
      '<span class="trend-label' + (m.key === viewMonth ? ' active' : '') + '">' + m.label + '</span>' +
      '</div>';
  }).join('');
}

function renderGoal(){
  const s = statsFor(viewMonth);
  const goal = Number(state.settings.savingsGoal) || 0;
  const saved = Math.max(s.balance, 0);
  const pct = goal > 0 ? Math.min(100, Math.round((saved / goal) * 100)) : 0;
  const done = goal > 0 && saved >= goal;

  $('goalBox').innerHTML =
    '<div class="goal">' +
      '<div class="goal-head">' +
        '<span>Meta de economia mensal</span>' +
        '<input class="goal-input" id="goalInput" inputmode="decimal" placeholder="definir meta" value="' + (goal ? fmtPlain(goal) : '') + '" aria-label="Meta de economia mensal">' +
      '</div>' +
      '<div class="bar"><div class="bar-fill" style="width:' + (done ? 100 : pct) + '%"></div></div>' +
      '<div class="goal-foot">' +
        '<span>' + (goal ? (done ? 'Meta batida! ' + fmtBRL(saved) + ' guardados' : fmtBRL(saved) + ' de ' + fmtBRL(goal)) : 'Defina uma meta para acompanhar') + '</span>' +
        '<span>' + (done ? '✓' : (goal ? pct + '%' : '')) + '</span>' +
      '</div>' +
    '</div>';
}

/* ---------- render: listas ---------- */

function txRowHtml(t, compact){
  const c = catById(t.category);
  const cls = compact ? 'tx-row compact' : 'tx-row';
  const actionAttr = compact ? ' data-action="edit" data-id="' + t.id + '" role="button" tabindex="0"' : '';
  let tag = t.recurringId ? '<span class="tag">fixo</span>' : '';
  if (t.cardId) tag += '<span class="tag card">cartão</span>';
  if (t.deferDays) tag += '<span class="tag defer">90 dias</span>';
  const paid = txIsPaid(t);
  const nRec = receiptCount(t.id);

  let meta = escapeHtml(c.name) + ' · ' + escapeHtml(t.method || 'Pix') + ' · ' + fmtDate(t.date);
  if (t.installment && t.installment.total > 1) meta += ' · ' + t.installment.index + '/' + t.installment.total;
  if (t.deferDays) meta += ' · cobra em ' + fmtDateFull(addDaysIso(t.date, t.deferDays));
  if (nRec) meta += ' · 📎 ' + nRec;

  const status = compact
    ? '<i class="pay-dot ' + (paid ? 'paid' : 'open') + '" title="' + payLabel(t) + '"></i>'
    : '<button class="pay-pill ' + (paid ? 'paid' : 'open') + '" type="button" data-action="toggle-paid" data-id="' + t.id + '" aria-pressed="' + (paid ? 'true' : 'false') + '" title="Toque para marcar como ' + (paid ? 'em aberto' : (t.type === 'income' ? 'recebida' : 'pago')) + '">' +
        (paid ? '✓ ' : '') + payLabel(t) +
      '</button>';

  const attach = compact ? '' :
    '<button class="mini-btn attach' + (nRec ? ' has' : '') + '" type="button" data-action="receipts" data-id="' + t.id + '" aria-label="Comprovantes de ' + escapeHtml(t.desc) + '" title="' + (nRec ? nRec + ' comprovante' + (nRec === 1 ? '' : 's') : 'Anexar comprovante') + '">' + icon('clip', 13) + '</button>';

  const actions = compact ? '' :
    '<div class="tx-actions">' +
      attach +
      '<button class="mini-btn" type="button" data-action="edit" data-id="' + t.id + '" aria-label="Editar ' + escapeHtml(t.desc) + '">' + icon('edit', 13) + '</button>' +
      '<button class="mini-btn danger" type="button" data-action="del" data-id="' + t.id + '" aria-label="Excluir ' + escapeHtml(t.desc) + '">' + icon('trash', 13) + '</button>' +
    '</div>';

  return '<div class="' + cls + '"' + actionAttr + '>' +
    '<span class="tx-ic" style="background:' + c.color + '1f;color:' + c.color + '">' + c.icon + '</span>' +
    '<div class="tx-main">' +
      '<div class="tx-title">' +
        '<span class="tx-desc">' + escapeHtml(t.desc) + '</span>' + tag + (compact ? status : '') +
      '</div>' +
      '<div class="tx-meta">' + (compact ? '' : status) + meta + '</div>' +
    '</div>' +
    '<span class="tx-amt ' + t.type + '">' + (t.type === 'income' ? '+' : '−') + ' ' + fmtBRL(t.amount) + '</span>' +
    actions +
  '</div>';
}

const WEEK_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function dayTitle(iso){
  const hoje = todayIso();
  if (iso === hoje) return 'Hoje · ' + fmtDate(iso);
  if (iso === addDaysIso(hoje, -1)) return 'Ontem · ' + fmtDate(iso);
  const d = new Date(iso + 'T12:00:00');
  return (WEEK_SHORT[d.getDay()] || '') + ' · ' + fmtDate(iso);
}

function groupByDay(list){
  const out = [];
  let atual = null;
  list.forEach(function(t){
    if (!atual || atual.date !== t.date) { atual = { date: t.date, items: [] }; out.push(atual); }
    atual.items.push(t);
  });
  return out;
}

function dayHeadHtml(date, items){
  const lista = Array.isArray(items) ? items : [];
  let soma = 0;
  lista.forEach(function(t){ soma += t.type === 'income' ? t.amount : -t.amount; });
  const resumo = Math.abs(soma) > 0.004
    ? (soma > 0 ? '+' : '−') + ' ' + fmtBRL(Math.abs(soma))
    : '';
  return '<div class="day-head"><span>' + dayTitle(date) + '</span>' +
    '<span class="day-sum">' + resumo + '</span></div>';
}

function renderRecent(){
  const todos = sortedTx(txByMonth(viewMonth));
  const box = $('recentBox');
  const foot = $('recentFoot');
  const sub = $('recentSub');

  if (!todos.length) {
    if (sub) sub.textContent = '';
    if (foot) foot.hidden = true;
    box.innerHTML = '<div class="empty"><strong>Nada por aqui ainda</strong>Registre uma despesa ou receita para começar.' +
      '<button class="btn btn-primary btn-sm" type="button" data-action="new">Adicionar lançamento</button></div>';
    return;
  }

  const list = todos.slice(0, 6);
  if (sub) sub.textContent = todos.length + (todos.length === 1 ? ' lançamento' : ' lançamentos');

  const grupos = groupByDay(list);
  const comDia = grupos.length > 1;
  box.innerHTML = grupos.map(function(g){
    return (comDia ? dayHeadHtml(g.date, g.items) : '') + g.items.map(function(t){ return txRowHtml(t, true); }).join('');
  }).join('');

  if (foot) {
    foot.hidden = todos.length <= list.length;
    const btn = $('recentSeeAll');
    if (btn) btn.textContent = 'Ver todos os ' + todos.length;
  }
}

function renderPending(){
  const due = recurringDue(viewMonth);
  const pending = due.filter(function(d){ return !d.launched; });
  const box = $('pendingBox');
  const sub = $('pendingSub');

  if (!state.recurrings.length) {
    sub.textContent = 'nenhuma cadastrada';
    box.innerHTML = '<div class="empty"><strong>Organize as contas do mês</strong>Cadastre aluguel, internet, assinaturas e outras contas que se repetem.' +
      '<button class="btn btn-ghost btn-sm" type="button" data-goto="fixos">Cadastrar conta fixa</button></div>';
    return;
  }

  if (!pending.length) {
    sub.textContent = 'em dia';
    box.innerHTML = '<div class="empty" style="padding:22px 10px"><strong>Tudo em dia ✓</strong>' +
      due.length + (due.length === 1 ? ' conta fixa lançada' : ' contas fixas lançadas') + ' neste mês.</div>';
    return;
  }

  const total = pending.reduce(function(sum, d){ return sum + d.rec.amount; }, 0);
  sub.textContent = pending.length + (pending.length === 1 ? ' pendente' : ' pendentes');

  box.innerHTML =
    '<div class="pending-total"><span>Total ainda não lançado</span><strong>' + fmtBRL(total) + '</strong></div>' +
    pending.slice(0, 4).map(function(d){
      const c = catById(d.rec.category);
      const day = dateForDay(viewMonth, d.rec.day).slice(8, 10);
      return '<div class="pending-row">' +
        '<span class="pending-day">' + day + '</span>' +
        '<div class="pending-main">' +
          '<div class="pending-name">' + escapeHtml(d.rec.desc) + '</div>' +
          '<div class="pending-meta">' + c.icon + ' ' + escapeHtml(c.name) + ' · todo dia ' + d.rec.day + '</div>' +
        '</div>' +
        '<span class="pending-amt">' + fmtBRL(d.rec.amount) + '</span>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-action="launch" data-id="' + d.rec.id + '">Lançar</button>' +
      '</div>';
    }).join('') +
    '<div class="pending-actions">' +
      (pending.length > 4 ? '<button class="btn btn-ghost btn-sm" type="button" data-goto="fixos">Ver todas</button>' : '') +
      '<button class="btn btn-primary btn-sm" type="button" data-action="launch-all">Lançar todas</button>' +
    '</div>';
}

function renderOpenStrip(){
  const el = $('openStrip');
  if (!el) return;
  const s = statsFor(viewMonth);
  if (!s.openCount) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML =
    '<span><strong>' + fmtBRL(s.openExpense) + '</strong> em ' +
      s.openCount + (s.openCount === 1 ? ' despesa em aberto' : ' despesas em aberto') +
    '</span>' +
    '<button class="btn btn-ghost btn-sm" type="button" data-action="see-open">Ver pendentes</button>';
}

function filteredTransactions(){
  let list = sortedTx(txByMonth(viewMonth));
  const q = filters.q.trim().toLowerCase();
  if (q) {
    list = list.filter(function(t){
      const hay = (t.desc + ' ' + catById(t.category).name + ' ' + (t.note || '')).toLowerCase();
      return hay.indexOf(q) > -1;
    });
  }
  if (filters.type) list = list.filter(function(t){ return t.type === filters.type; });
  if (filters.status === 'open') list = list.filter(function(t){ return !txIsPaid(t); });
  if (filters.status === 'paid') list = list.filter(function(t){ return txIsPaid(t); });
  if (filters.cat) list = list.filter(function(t){ return t.category === filters.cat; });
  return list;
}

function renderTransactions(){
  const list = filteredTransactions();
  const box = $('txList');
  const count = list.length;
  const total = list.reduce(function(sum, t){ return sum + (t.type === 'income' ? t.amount : -t.amount); }, 0);

  $('txCount').textContent = count + (count === 1 ? ' lançamento' : ' lançamentos');
  $('txTotal').textContent = fmtBRL(total);

  if (!list.length) {
    const hasAny = txByMonth(viewMonth).length > 0;
    box.innerHTML = '<div class="empty"><strong>' + (hasAny ? 'Nada encontrado' : 'Nenhum lançamento neste mês') + '</strong>' +
      (hasAny ? 'Tente ajustar a busca ou os filtros.' : 'Adicione uma despesa ou receita para começar.') +
      (hasAny ? '' : '<button class="btn btn-primary btn-sm" type="button" data-action="new">Adicionar lançamento</button>') +
      '</div>';
    return;
  }
  const grupos = groupByDay(list);
  const comDia = grupos.length > 1;
  box.innerHTML = grupos.map(function(g){
    return (comDia ? dayHeadHtml(g.date, g.items) : '') + g.items.map(function(t){ return txRowHtml(t, false); }).join('');
  }).join('');
}

function renderBudgets(){
  const s = statsFor(viewMonth);
  const map = expenseByCat(viewMonth);
  const limits = state.budgets || {};
  const budgetTotal = Object.keys(limits).reduce(function(sum, k){ return sum + (Number(limits[k]) || 0); }, 0);
  const spentTotal = s.expense;
  const pct = budgetTotal > 0 ? Math.min(100, Math.round((spentTotal / budgetTotal) * 100)) : 0;
  const summary = $('budgetSummary');

  if (budgetTotal <= 0) {
    summary.innerHTML = '<div><div class="big">Nenhum limite definido</div><div class="small">Defina um valor por categoria abaixo.</div></div>';
  } else {
    const rest = budgetTotal - spentTotal;
    summary.innerHTML =
      '<div>' +
        '<div class="big">' + fmtBRL(spentTotal) + ' <span style="font-size:12px;color:var(--muted);font-weight:400">de ' + fmtBRL(budgetTotal) + '</span></div>' +
        '<div class="small">' + pct + '% do orçamento usado · ' +
          (rest >= 0 ? 'restam ' + fmtBRL(rest) : 'estourou ' + fmtBRL(-rest)) +
        '</div>' +
      '</div>' +
      '<div style="min-width:140px;flex:1"><div class="bar"><div class="bar-fill" style="width:' + pct + '%;background:' + (rest < 0 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--accent)') + '"></div></div></div>';
  }

  const rows = EXPENSE_CATS.map(function(c){
    return { cat: c, spent: map[c.id] || 0, limit: Number(limits[c.id]) || 0 };
  }).sort(function(a, b){
    const aActive = a.spent > 0 || a.limit > 0;
    const bActive = b.spent > 0 || b.limit > 0;
    if (aActive !== bActive) return aActive ? -1 : 1;
    return Math.max(b.spent, b.limit) - Math.max(a.spent, a.limit);
  });

  $('budgetList').innerHTML = rows.map(function(row){
    const limit = row.limit;
    const spent = row.spent;
    const catPct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
    const color = limit > 0 && spent > limit ? 'var(--danger)' : limit > 0 && catPct >= 80 ? 'var(--warn)' : 'var(--accent)';
    const rest = limit - spent;
    const footRight = limit > 0
      ? (rest >= 0 ? '<span class="good">restam ' + fmtBRL(rest) + '</span>' : '<span class="bad">estourou ' + fmtBRL(-rest) + '</span>')
      : '<span>sem limite</span>';

    return '<div class="budget-row">' +
      '<div class="budget-top">' +
        '<span class="budget-ic" style="background:' + row.cat.color + '1f;color:' + row.cat.color + '">' + row.cat.icon + '</span>' +
        '<span class="budget-name">' + row.cat.name + '</span>' +
        '<input class="budget-input" data-cat="' + row.cat.id + '" inputmode="decimal" placeholder="—" value="' + (limit ? fmtPlain(limit) : '') + '" aria-label="Limite de ' + row.cat.name + '">' +
      '</div>' +
      '<div class="budget-track"><div class="bar"><div class="bar-fill" style="width:' + catPct + '%;background:' + color + '"></div></div></div>' +
      '<div class="budget-foot">' +
        '<span>' + fmtBRL(spent) + ' gasto' + (limit ? ' de ' + fmtBRL(limit) : '') + '</span>' +
        footRight +
      '</div>' +
    '</div>';
  }).join('');
}

function renderRecurrings(){
  const list = state.recurrings;
  $('recCount').textContent = list.length ? list.length + (list.length === 1 ? ' cadastrada' : ' cadastradas') : 'nenhuma';
  const box = $('recList');

  if (!list.length) {
    box.innerHTML = '<div class="empty"><strong>Nenhuma conta fixa</strong>Cadastre acima as contas que se repetem todo mês.</div>';
    return;
  }

  const due = recurringDue(viewMonth);
  box.innerHTML = list.map(function(r){
    const c = catById(r.category);
    const info = due.find(function(d){ return d.rec.id === r.id; });
    const launched = !!(info && info.launched);
    const status = !r.active
      ? '<span class="status-pill">pausada</span>'
      : launched
        ? '<span class="status-pill done">lançada</span>'
        : '<span class="status-pill">pendente</span>';

    return '<div class="rec-row">' +
      '<span class="tx-ic" style="background:' + c.color + '1f;color:' + c.color + '">' + c.icon + '</span>' +
      '<div class="rec-main">' +
        '<div class="rec-name">' + escapeHtml(r.desc) + ' ' + status + '</div>' +
        '<div class="rec-meta">Todo dia ' + r.day + ' · ' + escapeHtml(c.name) + ' · ' + (r.type === 'income' ? 'receita' : 'despesa') + (r.method === 'Crédito' ? ' · 💳 crédito' : '') + '</div>' +
      '</div>' +
      '<div class="rec-amt" style="color:var(--' + (r.type === 'income' ? 'in' : 'out') + ')">' + fmtBRL(r.amount) + '</div>' +
      '<div class="rec-actions">' +
        (r.active && !launched ? '<button class="btn btn-ghost btn-sm" type="button" data-action="launch" data-id="' + r.id + '">Lançar</button>' : '') +
        '<button class="pill-btn" type="button" data-action="toggle-rec" data-id="' + r.id + '" aria-pressed="' + (r.active ? 'true' : 'false') + '">' + (r.active ? 'ativa' : 'pausada') + '</button>' +
        '<button class="mini-btn danger" type="button" data-action="del-rec" data-id="' + r.id + '" aria-label="Excluir conta fixa">' + icon('trash', 13) + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ---------- render: cartão ---------- */

function cardShownMonth(card){
  return cardViewMonth || currentInvoiceMonth(card);
}

function fillCardForm(){
  const card = primaryCard();
  if (!$('c-name')) return;
  $('c-name').value = card ? card.name : 'Carrefour';
  $('c-limit').value = card && card.limit > 0 ? formatAmountInput(card.limit) : '';
  $('c-alert').value = state.settings.cardAlertPct || 80;
  $('c-closing').value = card ? card.closingDay : 30;
  $('c-due').value = card ? card.dueDay : 5;
}

function cardFixedRowHtml(r){
  const c = catById(r.category);
  const info = recurringDue(viewMonth).find(function(d){ return d.rec.id === r.id; });
  const launched = !!(info && info.launched);
  const status = !r.active
    ? '<span class="status-pill">pausada</span>'
    : launched
      ? '<span class="status-pill done">lançada</span>'
      : '<span class="status-pill">pendente</span>';

  return '<div class="card-fixed-row">' +
    '<span class="tx-ic" style="background:' + c.color + '1f;color:' + c.color + '">' + c.icon + '</span>' +
    '<div class="rec-main">' +
      '<div class="rec-name">' + escapeHtml(r.desc) + ' ' + status + '</div>' +
      '<div class="rec-meta">Todo dia ' + r.day + ' · ' + escapeHtml(c.name) + '</div>' +
    '</div>' +
    '<span class="rec-amt">' + fmtBRL(r.amount) + '</span>' +
    (r.active && !launched ? '<button class="btn btn-ghost btn-sm" type="button" data-action="launch" data-id="' + r.id + '">Lançar</button>' : '') +
  '</div>';
}

function renderCard(){
  const setup = $('cardSetup');
  const main = $('cardMain');
  if (!setup || !main) return;

  const card = primaryCard();
  const showSetup = !card || cardEditMode;
  setup.hidden = !showSetup;
  main.hidden = showSetup;

  if (showSetup) {
    if (!cardFormReady) { fillCardForm(); cardFormReady = true; }
    if ($('c-cancel')) $('c-cancel').hidden = !card;
    return;
  }

  const info = cardLimitInfo(card);
  const alertPct = state.settings.cardAlertPct || 80;
  const mk = cardShownMonth(card);
  const inv = cardInvoice(mk, card);
  const atual = currentInvoiceMonth(card);
  const isCurrent = mk === atual;
  const today = todayIso();
  const late = inv.total > 0 && !inv.allPaid && inv.dueDate < today;
  const pctClass = info.pct >= 90 ? 'danger' : (info.pct >= alertPct ? 'warn' : '');

  let alerta = '';
  if (info.limit <= 0) {
    alerta = '<div class="card-alert"><span>Defina o <strong>limite do cartão</strong> para acompanhar quanto ainda dá para gastar. Toque no lápis para ajustar.</span></div>';
  } else if (info.pct >= alertPct) {
    alerta = '<div class="card-alert' + (info.pct >= 100 ? ' danger' : '') + '"><span><strong>' + info.pct + '% do limite</strong> comprometido. Disponível ' + fmtBRL(info.available) + '. Evite novas compras até pagar a fatura.</span></div>';
  }

  let pagoInfo = '';
  if (inv.total > 0) {
    pagoInfo = inv.allPaid ? ' · fatura paga ✓'
      : (inv.paidTotal > 0 ? ' · ' + fmtBRL(inv.paidTotal) + ' já pago' : '');
  }

  const proj = [1, 2, 3].map(function(i){
    const m2 = shiftMonth(mk, i);
    const v = cardInvoice(m2, card).total;
    return '<button class="card-proj-item" type="button" data-action="card-go" data-id="' + m2 + '">' +
      '<span>' + monthShort(m2) + '</span>' +
      '<strong>' + (v > 0 ? fmtBRL(v) : '—') + '</strong>' +
      '<em>vence ' + fmtDate(invoiceDueDate(card, m2)) + '</em>' +
    '</button>';
  }).join('');

  $('cardHero').innerHTML =
    '<div class="card-hero-top">' +
      '<div>' +
        '<span class="card-brand">Cartão</span>' +
        '<div class="card-name">' + escapeHtml(card.name) + '</div>' +
        '<div class="card-dates">fecha dia ' + card.closingDay + ' · vence dia ' + card.dueDay + '</div>' +
      '</div>' +
      '<div class="card-inv-nav">' +
        '<button class="mini-btn" type="button" data-action="card-prev" aria-label="Fatura anterior" title="Fatura anterior">' + icon('chevL', 14) + '</button>' +
        (isCurrent ? '' : '<button class="mini-btn" type="button" data-action="card-today" aria-label="Voltar para a fatura atual" title="Fatura atual">' + icon('check', 14) + '</button>') +
        '<button class="mini-btn" type="button" data-action="card-next" aria-label="Próxima fatura" title="Próxima fatura">' + icon('chevR', 14) + '</button>' +
        '<button class="mini-btn" type="button" data-action="edit-card" aria-label="Editar cartão" title="Editar cartão">' + icon('edit', 14) + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="card-inv">' +
      '<span class="card-inv-label">Fatura de ' + monthLong(mk) + (isCurrent ? ' · atual' : '') + '</span>' +
      '<strong class="card-inv-total">' + fmtBRL(inv.total) + '</strong>' +
      '<span class="card-inv-due' + (late ? ' late' : '') + '">' +
        (inv.total > 0 ? 'vence ' + fmtDateFull(inv.dueDate) : 'sem compras nesta fatura') + pagoInfo +
      '</span>' +
    '</div>' +
    '<div class="limit-box">' +
      '<div class="limit-head"><span>Limite comprometido</span><strong>' + fmtBRL(info.used) + ' de ' + fmtBRL(info.limit) + '</strong></div>' +
      '<div class="limit-track"><span class="limit-fill ' + pctClass + '" style="width:' + info.pct + '%"></span></div>' +
      '<div class="limit-foot"><span>Disponível ' + fmtBRL(info.available) + '</span><span>' + info.pct + '% usado</span></div>' +
    '</div>' +
    alerta +
    '<div class="card-actions">' +
      '<button class="btn btn-primary btn-sm" type="button" data-action="card-new">+ Compra no cartão</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-action="card-fuel">⛽ Combustível · 90 dias</button>' +
      (inv.total > 0 && !inv.allPaid ? '<button class="btn btn-ghost btn-sm" type="button" data-action="card-pay">Pagar fatura</button>' : '') +
    '</div>' +
    '<div class="card-proj">' + proj + '</div>';

  $('cardInvoiceSub').textContent = inv.items.length
    ? inv.items.length + (inv.items.length === 1 ? ' compra' : ' compras')
    : 'nada nesta fatura';

  if (!inv.items.length) {
    $('cardList').innerHTML = '<div class="empty"><strong>Nenhuma compra nesta fatura</strong>' +
      'Lance uma compra ou uma conta fixa no cartão para ela aparecer aqui.</div>';
  } else {
    $('cardList').innerHTML = inv.items.map(function(t){ return txRowHtml(t, false); }).join('');
  }

  const fixed = (state.recurrings || []).filter(function(r){ return r.method === 'Crédito'; });
  const fixedTotal = cardFixedMonthly(card);
  $('cardFixedTotal').textContent = fixedTotal > 0 ? fmtBRL(fixedTotal) + '/mês' : 'nenhuma';

  if (!fixed.length) {
    $('cardFixedList').innerHTML = '<div class="empty"><strong>Sem assinaturas no cartão</strong>' +
      'Academia, TV, telefone e internet entram aqui quando você cadastra a conta fixa com a forma <strong>Crédito</strong>.' +
      '<button class="btn btn-ghost btn-sm" type="button" data-goto="fixos">Ir para contas fixas</button></div>';
  } else {
    $('cardFixedList').innerHTML = fixed.map(cardFixedRowHtml).join('');
  }
}

function render(){
  renderMonthBar();
  renderKpis();
  renderOpenStrip();
  renderDonut();
  renderTrend();
  renderGoal();
  renderPending();
  renderRecent();
  renderTransactions();
  renderBudgets();
  renderCard();
  renderRecurrings();
  renderReport();
  renderSync();
}

function initNativeChrome(){
  /* O tema nativo (barra de status + fundo da janela) é aplicado por applyTheme(). */
}

/* ---------- modal ---------- */

function setModalType(type, selected){
  modalType = type;
  $('typeExpense').classList.toggle('active', type === 'expense');
  $('typeIncome').classList.toggle('active', type === 'income');
  $('typeExpense').setAttribute('aria-pressed', type === 'expense' ? 'true' : 'false');
  $('typeIncome').setAttribute('aria-pressed', type === 'income' ? 'true' : 'false');
  fillTypeCategories($('m-cat'), type, selected);
  $('m-paidLabel').textContent = type === 'income' ? 'Já foi recebido' : 'Já foi pago';
  $('m-paidHint').textContent = type === 'income' ? 'Fica verde no extrato como recebida' : 'Fica verde no extrato como paga';
}

function setModalPaid(paid){
  modalPaid = !!paid;
  $('m-paid').setAttribute('aria-checked', modalPaid ? 'true' : 'false');
  $('m-paid').classList.toggle('on', modalPaid);
}

function setModalDefer(on){
  modalDefer = !!on;
  const btn = $('m-defer');
  if (btn) {
    btn.classList.toggle('on', modalDefer);
    btn.setAttribute('aria-checked', modalDefer ? 'true' : 'false');
  }
  updateCardFields();
}

function updateCardFields(){
  const fields = $('m-cardFields');
  const warn = $('m-cardWarn');
  if (!fields || !warn) return;

  const card = primaryCard();
  const isCredit = modalType === 'expense' && $('m-method').value === 'Crédito';
  fields.hidden = !(isCredit && card);
  warn.hidden = !(isCredit && !card);

  if (!isCredit || !card) { updateCardHint(); return; }

  /* O adiamento de 90 dias é exclusivo do combustível. */
  const isFuel = $('m-cat') && $('m-cat').value === 'transporte';
  const showDefer = isFuel;
  const row = $('m-deferRow');
  if (row) row.hidden = !showDefer;
  if (!showDefer && modalDefer) {
    modalDefer = false;
    $('m-defer').classList.remove('on');
    $('m-defer').setAttribute('aria-checked', 'false');
  }

  $('m-cardName').textContent = card.name;
  if ($('m-installmentsField')) $('m-installmentsField').hidden = !!editingId || modalDefer;
  updateCardHint();
}

function updateCardHint(){
  const hint = $('m-cardHint');
  const note = $('m-cardNote');
  if (!hint) return;

  const card = primaryCard();
  if (!card) { hint.textContent = ''; if (note) note.textContent = ''; return; }

  const date = $('m-date').value || defaultDate();
  const amount = parseAmount($('m-amount').value) || 0;
  const n = Math.max(1, parseInt($('m-installments').value, 10) || 1);
  const defer = modalDefer ? 90 : 0;
  const mk = txInvoiceMonth({ date: date, deferDays: defer, cardId: card.id }, card);

  hint.textContent = 'Fatura de ' + monthLong(mk) + ' · vence ' + fmtDateFull(invoiceDueDate(card, mk));

  let texto = '';
  if (defer) {
    texto = '⛽ Pagamento em ' + fmtDateFull(addDaysIso(date, 90)) + ' — entra na fatura de ' + monthLong(mk) + '.';
  } else if (n > 1 && amount > 0) {
    texto = n + 'x de ' + fmtBRL(round2(amount / n)) + ', começando em ' + monthLong(date.slice(0, 7)) + '.';
  }
  if (note) note.textContent = texto;
}

function clearModalUrls(){
  modalUrls.forEach(function(u){ try { URL.revokeObjectURL(u); } catch (e) {} });
  modalUrls = [];
}

function defaultDate(){
  const today = todayIso();
  if (today.slice(0, 7) === viewMonth) return today;
  const day = Math.min(new Date().getDate(), daysInMonth(viewMonth));
  return viewMonth + '-' + pad2(day);
}

function openModal(tx, preset){
  editingId = tx ? tx.id : null;
  const type = tx ? tx.type : 'expense';
  const pre = preset || {};

  pendingReceipts = [];
  clearModalUrls();

  $('modalTitle').textContent = tx ? 'Editar lançamento' : 'Novo lançamento';
  $('m-save').textContent = tx ? 'Salvar alterações' : 'Adicionar';
  $('m-desc').value = tx ? tx.desc : (pre.desc || '');
  $('m-amount').value = tx ? formatAmountInput(tx.amount) : '';
  $('m-date').value = tx ? tx.date : defaultDate();
  $('m-method').value = tx
    ? (tx.method && METHODS.indexOf(tx.method) > -1 ? tx.method : 'Pix')
    : (pre.method || 'Pix');
  $('m-note').value = tx && tx.note ? tx.note : '';
  $('m-installments').value = '1';
  $('m-installments').disabled = !!tx;
  setModalPaid(tx ? !!tx.paid : false);
  setModalType(type, tx ? tx.category : (pre.category || null));
  setModalDefer(tx ? !!tx.deferDays : !!pre.defer);
  updateCardFields();
  renderModalReceipts();

  $('modal').classList.add('open');
  $('modal').setAttribute('aria-hidden', 'false');
  $('modal').inert = false;
  document.body.style.overflow = 'hidden';
  setTimeout(function(){ $('m-desc').focus(); }, 60);
}

function closeModal(){
  $('modal').classList.remove('open');
  $('modal').setAttribute('aria-hidden', 'true');
  $('modal').inert = true;
  document.body.style.overflow = '';
  editingId = null;
  pendingReceipts = [];
  clearModalUrls();
}

/* ---------- comprovantes ---------- */

function receiptItemHtml(m, removable){
  const thumb = m.kind === 'image'
    ? '<img class="receipt-thumb" data-thumb="' + m.id + '" alt="Comprovante">'
    : '<span class="receipt-thumb file">' + icon('doc', 20) + '</span>';

  return '<div class="receipt-item" data-action="open-receipt" data-id="' + m.id + '" role="button" tabindex="0">' +
    thumb +
    '<div class="receipt-main">' +
      '<span class="receipt-name">' + escapeHtml(m.name) + '</span>' +
      '<span class="receipt-size">' + (m.kind === 'pdf' ? 'PDF' : 'Foto') + ' · ' + fmtBytes(m.size) + '</span>' +
    '</div>' +
    (removable ? '<button class="mini-btn danger" type="button" data-action="del-receipt" data-id="' + m.id + '" aria-label="Remover comprovante">' + icon('trash', 13) + '</button>' : '') +
  '</div>';
}

function pendingItemHtml(file, i){
  return '<div class="receipt-item pending">' +
    '<span class="receipt-thumb file" data-pending-thumb="' + i + '">' + icon('doc', 20) + '</span>' +
    '<div class="receipt-main">' +
      '<span class="receipt-name">' + escapeHtml(file.name || 'comprovante') + '</span>' +
      '<span class="receipt-size">Novo · ' + fmtBytes(file.size) + '</span>' +
    '</div>' +
    '<button class="mini-btn danger" type="button" data-action="del-pending" data-index="' + i + '" aria-label="Remover comprovante">' + icon('trash', 13) + '</button>' +
  '</div>';
}

function loadThumbs(container, list, urls){
  const store = recStore();
  if (!store) return;
  list.forEach(function(m){
    if (m.kind !== 'image') return;
    store.get(m.id).then(function(row){
      if (!row || !row.blob) return;
      const img = container.querySelector('[data-thumb="' + m.id + '"]');
      if (!img) return;
      const url = URL.createObjectURL(row.blob);
      urls.push(url);
      img.src = url;
    }).catch(function(){});
  });
}

function renderModalReceipts(){
  const box = $('m-receipts');
  if (!box) return;

  const existing = editingId ? receiptsOf(editingId) : [];
  let html = existing.map(function(m){ return receiptItemHtml(m, true); }).join('');
  html += pendingReceipts.map(function(f, i){ return pendingItemHtml(f, i); }).join('');
  box.innerHTML = html || '<span class="receipt-empty">Nenhum comprovante anexado.</span>';

  pendingReceipts.forEach(function(f, i){
    if (!/^image\//.test(f.type || '')) return;
    const holder = box.querySelector('[data-pending-thumb="' + i + '"]');
    if (!holder) return;
    const url = URL.createObjectURL(f);
    modalUrls.push(url);
    const img = document.createElement('img');
    img.className = 'receipt-thumb';
    img.alt = 'Comprovante';
    img.src = url;
    holder.replaceWith(img);
  });

  loadThumbs(box, existing, modalUrls);
}

function openReceiptViewer(txId){
  viewerUrls.forEach(function(u){ try { URL.revokeObjectURL(u); } catch (e) {} });
  viewerUrls = [];
  viewerTxId = txId;
  $('viewer').classList.add('open');
  $('viewer').setAttribute('aria-hidden', 'false');
  $('viewer').inert = false;
  document.body.style.overflow = 'hidden';
  renderReceiptViewer();
}

function closeReceiptViewer(){
  $('viewer').classList.remove('open');
  $('viewer').setAttribute('aria-hidden', 'true');
  $('viewer').inert = true;
  if (!$('modal').classList.contains('open')) document.body.style.overflow = '';
  viewerTxId = null;
  viewerUrls.forEach(function(u){ try { URL.revokeObjectURL(u); } catch (e) {} });
  viewerUrls = [];
}

function renderReceiptViewer(){
  const tx = state.transactions.find(function(t){ return t.id === viewerTxId; });
  if (!tx) { closeReceiptViewer(); return; }

  const list = receiptsOf(tx.id);
  $('viewerTitle').textContent = 'Comprovantes';
  $('viewerBody').innerHTML =
    '<div class="viewer-sub">' + escapeHtml(tx.desc) + ' · ' + fmtBRL(tx.amount) + ' · ' + payLabel(tx) + '</div>' +
    (list.length
      ? '<div class="receipt-list">' + list.map(function(m){ return receiptItemHtml(m, true); }).join('') + '</div>'
      : '<div class="empty" style="padding:18px 8px"><strong>Nenhum comprovante</strong>Anexe a foto ou o PDF do pagamento.</div>');

  $('viewerActions').innerHTML =
    '<button class="btn btn-ghost" type="button" data-viewer-close>Fechar</button>' +
    '<button class="btn btn-primary" type="button" data-action="viewer-attach" data-id="' + tx.id + '">Anexar comprovante</button>';

  loadThumbs($('viewerBody'), list, viewerUrls);
}

function viewReceipt(id){
  const store = recStore();
  const m = store ? store.meta(id) : null;
  if (!store || !m) { toast('Comprovante não encontrado.'); return; }

  store.get(id).then(function(row){
    if (!row || !row.blob) { toast('Não foi possível abrir o comprovante.'); return; }

    const url = URL.createObjectURL(row.blob);
    viewerUrls.push(url);

    if (m.kind === 'image') {
      $('viewerBody').innerHTML = '<img class="receipt-full" alt="Comprovante" src="' + url + '">';
      $('viewerActions').innerHTML =
        '<button class="btn btn-ghost" type="button" data-action="viewer-back">Voltar</button>' +
        '<button class="btn btn-primary" type="button" data-action="save-receipt" data-id="' + m.id + '">' + (isNativeApp() ? 'Abrir' : 'Baixar foto') + '</button>';
    } else {
      $('viewerBody').innerHTML =
        '<div class="pdf-preview">' + icon('doc', 34) + '<strong>' + escapeHtml(m.name) + '</strong><span>PDF · ' + fmtBytes(m.size) + '</span></div>';
      $('viewerActions').innerHTML =
        '<button class="btn btn-ghost" type="button" data-action="viewer-back">Voltar</button>' +
        '<button class="btn btn-primary" type="button" data-action="save-receipt" data-id="' + m.id + '">' + (isNativeApp() ? 'Abrir PDF' : 'Baixar PDF') + '</button>';
    }
  }).catch(function(){ toast('Não foi possível abrir o comprovante.'); });
}

function saveReceipt(id){
  const store = recStore();
  if (!store) return;
  const m = store.meta(id);
  store.get(id).then(async function(row){
    if (!row || !row.blob) { toast('Não foi possível abrir o comprovante.'); return; }
    const name = (m && m.name) || (row.blob.type === 'application/pdf' ? 'comprovante.pdf' : 'comprovante.jpg');

    if (isNativeApp()) {
      try {
        const b64 = await blobToBase64(row.blob);
        await window.FluxoNative.saveFileBase64(b64, name);
        toast('Comprovante pronto para abrir ou compartilhar');
      } catch (err) {
        toast('Não foi possível abrir o comprovante.');
      }
      return;
    }

    if (row.blob.type === 'application/pdf') {
      const url = URL.createObjectURL(row.blob);
      const win = window.open(url, '_blank');
      if (!win) downloadBlob(row.blob, name);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
    } else {
      downloadBlob(row.blob, name);
    }
  }).catch(function(){ toast('Não foi possível abrir o comprovante.'); });
}

function pickAttachments(target){
  attachTarget = target;
  const input = $('attachInput');
  input.value = '';
  input.click();
}

async function addReceiptsTo(txId, files, opts){
  const store = recStore();
  if (!store) { toast('Armazenamento de comprovantes indisponível.'); return 0; }

  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      await store.add(txId, files[i]);
      ok += 1;
    } catch (err) {
      toast(err.message || 'Não foi possível anexar o comprovante.');
    }
  }

  if (ok) {
    render();
    if ($('modal').classList.contains('open') && editingId) renderModalReceipts();
    if ($('viewer').classList.contains('open')) renderReceiptViewer();
    if (!(opts && opts.silent)) toast(ok === 1 ? 'Comprovante anexado' : ok + ' comprovantes anexados');
  }
  return ok;
}

async function handleAttachments(files){
  const target = attachTarget;
  attachTarget = null;
  if (!target || !files.length) return;

  if (target.pending) {
    pendingReceipts = pendingReceipts.concat(files);
    renderModalReceipts();
    toast('Comprovante será anexado ao salvar');
    return;
  }

  await addReceiptsTo(target.txId, files);
}

async function deleteReceipt(id){
  const store = recStore();
  if (!store) return;
  if (!confirm('Remover este comprovante? Ele será apagado do aparelho.')) return;
  try {
    await store.remove(id);
    if ($('viewer').classList.contains('open')) {
      if (state.transactions.some(function(t){ return t.id === viewerTxId; })) renderReceiptViewer();
      else closeReceiptViewer();
    }
    render();
    if ($('modal').classList.contains('open')) renderModalReceipts();
    toast('Comprovante removido');
  } catch (err) {
    toast('Não foi possível remover o comprovante.');
  }
}

/* ---------- navegação ---------- */

function switchTab(tab){
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(function(b){
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.view').forEach(function(v){
    v.hidden = v.id !== 'view-' + tab;
  });
  $('monthBar').style.display = tab === 'dados' ? 'none' : '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- backup ---------- */

function download(content, filename, mime){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 500);
}

async function deliverFile(content, filename, mime){
  const native = window.FluxoNative;
  if (native && native.isNative) {
    await native.saveFile(content, filename, mime);
    return 'share';
  }
  download(content, filename, mime);
  return 'download';
}

async function exportJson(){
  const payload = Object.assign({ app: 'Fluxo', exportedAt: new Date().toISOString() }, state);
  try {
    const how = await deliverFile(JSON.stringify(payload, null, 2), 'fluxo-backup-' + todayIso() + '.json', 'application/json');
    toast(how === 'share' ? 'Backup pronto para salvar' : 'Backup baixado');
  } catch (err) {
    toast('Não foi possível exportar o backup.');
  }
}

async function exportCsv(){
  const rows = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Forma de pagamento', 'Cartão', 'Fatura', 'Situação', 'Valor']];
  sortedTx(state.transactions).slice().reverse().forEach(function(t){
    const card = t.cardId ? txCard(t) : null;
    rows.push([
      t.date.slice(8, 10) + '/' + t.date.slice(5, 7) + '/' + t.date.slice(0, 4),
      t.type === 'income' ? 'Receita' : 'Despesa',
      t.desc,
      catById(t.category).name,
      t.method || '',
      card ? card.name : '',
      card ? monthLong(txInvoiceMonth(t, card)) : '',
      t.paid ? (t.type === 'income' ? 'Recebida' : 'Paga') : 'Em aberto',
      String(t.amount).replace('.', ',')
    ]);
  });
  const csv = '\uFEFF' + rows.map(function(r){
    return r.map(function(f){ return '"' + String(f == null ? '' : f).replace(/"/g, '""') + '"'; }).join(';');
  }).join('\r\n');
  try {
    const how = await deliverFile(csv, 'fluxo-lancamentos-' + todayIso() + '.csv', 'text/csv;charset=utf-8');
    toast(how === 'share' ? 'Planilha pronta para salvar' : 'Planilha exportada');
  } catch (err) {
    toast('Não foi possível exportar a planilha.');
  }
}

function importJson(file){
  const reader = new FileReader();
  reader.onload = function(){
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || !Array.isArray(parsed.transactions)) throw new Error('formato não reconhecido');
      if (!confirm('Restaurar este backup? Os dados atuais serão substituídos.')) return;
      state = normalizeState(parsed);
      saveState();
      if (recStore()) recStore().clear();
      applyTheme();
      viewMonth = thisMonthKey();
      render();
      toast('Backup restaurado');
    } catch (err) {
      toast('Arquivo inválido: ' + err.message);
    }
  };
  reader.onerror = function(){ toast('Não foi possível ler o arquivo.'); };
  reader.readAsText(file);
}

/* ---------- PWA ---------- */

function registerServiceWorker(){
  if (window.FluxoNative && window.FluxoNative.isNative) return;
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function(){});
  }
}

function setupInstall(){
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredPrompt = e;
    const btn = $('installBtn');
    if (btn) btn.hidden = false;
  });
  window.addEventListener('appinstalled', function(){
    deferredPrompt = null;
    const btn = $('installBtn');
    if (btn) btn.hidden = true;
    toast('App instalado no aparelho');
  });
}

/* ---------- eventos ---------- */

function bind(){
  $('themeBtn').addEventListener('click', toggleTheme);

  document.addEventListener('click', async function(e){
    const go = e.target.closest('[data-goto]');
    if (go) {
      e.preventDefault();
      switchTab(go.dataset.goto);
      return;
    }

    if (e.target.id === 'modal') { closeModal(); return; }
    if (e.target.id === 'viewer') { closeReceiptViewer(); return; }

    if (e.target.closest('[data-viewer-close]')) { closeReceiptViewer(); return; }
    if (e.target.closest('[data-close]')) { closeModal(); return; }

    const tab = e.target.closest('[data-tab]');
    if (tab) { switchTab(tab.dataset.tab); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;

    if (action === 'new') { openModal(null); return; }

    if (action === 'edit-card') {
      cardEditMode = true;
      cardFormReady = false;
      render();
      var cName = $('c-name');
      if (cName) setTimeout(function(){ cName.focus(); }, 60);
      return;
    }

    if (action === 'card-cancel') {
      cardEditMode = false;
      cardFormReady = false;
      render();
      return;
    }

    if (action === 'card-new') {
      openModal(null, { method: 'Crédito' });
      return;
    }

    if (action === 'card-fuel') {
      openModal(null, { method: 'Crédito', category: 'transporte', desc: 'Combustível', defer: true });
      return;
    }

    if (action === 'card-prev') {
      cardViewMonth = shiftMonth(cardShownMonth(primaryCard()), -1);
      render();
      return;
    }

    if (action === 'card-next') {
      cardViewMonth = shiftMonth(cardShownMonth(primaryCard()), 1);
      render();
      return;
    }

    if (action === 'card-go') {
      cardViewMonth = id || null;
      render();
      return;
    }

    if (action === 'card-today') {
      cardViewMonth = null;
      render();
      return;
    }

    if (action === 'card-pay') {
      const card = primaryCard();
      if (!card) return;
      const mk = cardShownMonth(card);
      const inv = cardInvoice(mk, card);
      const abertas = inv.items.filter(function(t){ return !txIsPaid(t); });
      if (!abertas.length) { toast('Essa fatura já está paga.'); return; }
      const msg = 'Pagar a fatura de ' + monthLong(mk) + ' (' + fmtBRL(inv.total) + ')?\n\n' +
        abertas.length + (abertas.length === 1 ? ' compra será marcada como paga' : ' compras serão marcadas como pagas') +
        ' e o limite será liberado. Não cria despesa nova.';
      if (!confirm(msg)) return;
      const agora = Date.now();
      abertas.forEach(function(t){ t.paid = true; t.paidAt = agora; });
      saveState();
      render();
      toast('Fatura paga · limite liberado');
      return;
    }

    if (action === 'toggle-paid') {
      const tx = state.transactions.find(function(t){ return t.id === id; });
      if (!tx) return;
      const paid = !txIsPaid(tx);
      setTransactionPaid(id, paid);
      render();
      toast(paid
        ? (tx.type === 'income' ? 'Marcada como recebida' : 'Marcada como paga')
        : 'Voltou para em aberto');
      return;
    }

    if (action === 'see-open') {
      filters.status = 'open';
      $('f-status').value = 'open';
      switchTab('lancamentos');
      renderTransactions();
      return;
    }

    if (action === 'receipts') {
      if (receiptCount(id)) openReceiptViewer(id);
      else pickAttachments({ txId: id });
      return;
    }

    if (action === 'viewer-attach') {
      pickAttachments({ txId: id });
      return;
    }

    if (action === 'open-receipt') {
      const store = recStore();
      const m = store ? store.meta(id) : null;
      if (m && !$('viewer').classList.contains('open')) openReceiptViewer(m.txId);
      viewReceipt(id);
      return;
    }

    if (action === 'save-receipt') {
      saveReceipt(id);
      return;
    }

    if (action === 'viewer-back') {
      renderReceiptViewer();
      return;
    }

    if (action === 'del-receipt') {
      deleteReceipt(id);
      return;
    }

    if (action === 'del-pending') {
      pendingReceipts.splice(Number(el.dataset.index), 1);
      renderModalReceipts();
      return;
    }

    if (action === 'edit') {
      const tx = state.transactions.find(function(t){ return t.id === id; });
      if (tx) openModal(tx);
      return;
    }

    if (action === 'del') {
      const tx = state.transactions.find(function(t){ return t.id === id; });
      if (!tx) return;
      const hasRec = receiptCount(id) > 0;
      const msg = 'Excluir “' + tx.desc + '”?' + (hasRec ? ' O comprovante anexado também será apagado.' : ' Essa ação não pode ser desfeita.');
      if (confirm(msg)) {
        deleteTransaction(id);
        if (recStore() && hasRec) recStore().removeByTx(id).catch(function(){});
        render();
        toast('Lançamento excluído');
      }
      return;
    }

    if (action === 'launch') {
      if (launchRecurring(id)) {
        render();
        toast('Conta lançada neste mês');
      }
      return;
    }

    if (action === 'launch-all') {
      const n = launchAllPending();
      render();
      toast(n ? n + (n === 1 ? ' conta lançada' : ' contas lançadas') + ' neste mês' : 'Nada pendente por aqui');
      return;
    }

    if (action === 'toggle-rec') {
      const r = state.recurrings.find(function(x){ return x.id === id; });
      if (r) {
        r.active = !r.active;
        saveState();
        render();
        toast(r.active ? 'Conta fixa reativada' : 'Conta fixa pausada');
      }
      return;
    }

    if (action === 'del-rec') {
      const r = state.recurrings.find(function(x){ return x.id === id; });
      if (!r) return;
      if (confirm('Excluir a conta fixa “' + r.desc + '”? Os lançamentos já feitos serão mantidos.')) {
        state.recurrings = state.recurrings.filter(function(x){ return x.id !== id; });
        saveState();
        render();
        toast('Conta fixa excluída');
      }
      return;
    }
  });

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') {
      if ($('viewer').classList.contains('open')) { closeReceiptViewer(); return; }
      if ($('modal').classList.contains('open')) { closeModal(); return; }
    }
    if (e.key === 'Enter' && e.target.classList && (e.target.classList.contains('tx-row') || e.target.classList.contains('receipt-item'))) {
      e.target.click();
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (e.key.toLowerCase() === 'n' && tag !== 'input' && tag !== 'select' && tag !== 'textarea' && !$('modal').classList.contains('open')) {
      e.preventDefault();
      openModal(null);
    }
  });

  $('prevMonth').addEventListener('click', function(){
    viewMonth = shiftMonth(viewMonth, -1);
    render();
  });
  $('nextMonth').addEventListener('click', function(){
    viewMonth = shiftMonth(viewMonth, 1);
    render();
  });
  $('todayBtn').addEventListener('click', function(){
    viewMonth = thisMonthKey();
    render();
  });

  $('typeExpense').addEventListener('click', function(){ setModalType('expense', null); updateCardFields(); });
  $('typeIncome').addEventListener('click', function(){ setModalType('income', null); updateCardFields(); });

  $('m-paid').addEventListener('click', function(){ setModalPaid(!modalPaid); });

  $('m-defer').addEventListener('click', function(){ setModalDefer(!modalDefer); });
  $('m-method').addEventListener('change', updateCardFields);
  $('m-cat').addEventListener('change', updateCardFields);
  $('m-installments').addEventListener('change', updateCardHint);
  $('m-date').addEventListener('change', updateCardHint);
  $('m-amount').addEventListener('input', updateCardHint);

  $('m-attach').addEventListener('click', function(){
    pickAttachments(editingId ? { txId: editingId } : { pending: true });
  });

  $('attachInput').addEventListener('change', function(e){
    const files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    if (files.length) handleAttachments(files);
  });

  $('m-amount').addEventListener('blur', function(e){
    const v = parseAmount(e.target.value);
    if (v > 0) e.target.value = formatAmountInput(v);
  });
  $('r-amount').addEventListener('blur', function(e){
    const v = parseAmount(e.target.value);
    if (v > 0) e.target.value = formatAmountInput(v);
  });

  $('txForm').addEventListener('submit', function(e){
    e.preventDefault();
    const wasEdit = !!editingId;
    const desc = $('m-desc').value.trim();
    const amount = parseAmount($('m-amount').value);
    const date = $('m-date').value;
    const category = $('m-cat').value;
    const method = $('m-method').value;

    if (!desc) { toast('Informe uma descrição.'); $('m-desc').focus(); return; }
    if (!(amount > 0)) { toast('Informe um valor maior que zero.'); $('m-amount').focus(); return; }
    if (!date) { toast('Informe a data.'); $('m-date').focus(); return; }
    if (!category) { toast('Escolha uma categoria.'); return; }

    const card = primaryCard();
    const isCredit = modalType === 'expense' && method === 'Crédito' && !!card;
    const defer = isCredit && modalDefer && category === 'transporte' ? 90 : 0;
    const parcels = isCredit && !wasEdit && !defer ? Math.max(1, Math.min(12, parseInt($('m-installments').value, 10) || 1)) : 1;

    if (modalType === 'expense' && method === 'Crédito' && !card) {
      toast('Cadastre seu cartão na aba Cartão para lançar no crédito.');
      return;
    }

    const payload = {
      type: modalType,
      desc: desc,
      category: category,
      amount: amount,
      date: date,
      method: method,
      note: $('m-note').value.trim(),
      paid: !!modalPaid,
      paidAt: modalPaid ? Date.now() : 0
    };
    if (isCredit) payload.cardId = card.id;
    if (defer) payload.deferDays = defer;

    let txId = editingId;
    if (wasEdit) {
      const tx = state.transactions.find(function(t){ return t.id === editingId; });
      if (tx) {
        Object.assign(tx, payload);
        if (!isCredit) { delete tx.cardId; delete tx.deferDays; }
        else if (!defer) { delete tx.deferDays; }
      }
    } else if (parcels > 1) {
      const groupId = uid();
      const cents = Math.round(amount * 100);
      const baseCents = Math.floor(cents / parcels);
      const day = parseInt(date.slice(8, 10), 10) || 1;
      let acc = 0;

      for (let i = 0; i < parcels; i++) {
        const valueCents = i === parcels - 1 ? cents - acc : baseCents;
        acc += valueCents;
        const mk = shiftMonth(date.slice(0, 7), i);
        const item = Object.assign({}, payload, {
          id: uid(),
          amount: valueCents / 100,
          date: dateForDay(mk, day),
          paid: false,
          paidAt: 0,
          installment: { index: i + 1, total: parcels, groupId: groupId },
          createdAt: Date.now()
        });
        state.transactions.push(item);
        if (i === 0) txId = item.id;
      }
    } else {
      txId = uid();
      state.transactions.push(Object.assign({ id: txId, createdAt: Date.now() }, payload));
    }

    saveState();

    const files = pendingReceipts.slice();
    pendingReceipts = [];

    viewMonth = date.slice(0, 7);
    closeModal();
    render();
    toast(wasEdit ? 'Lançamento atualizado' : 'Lançamento adicionado');

    /* anexa em segundo plano: fechar o modal não perde os comprovantes */
    if (files.length) addReceiptsTo(txId, files, { silent: true });
  });

  $('f-q').addEventListener('input', function(e){
    filters.q = e.target.value;
    renderTransactions();
  });
  $('f-type').addEventListener('change', function(e){
    filters.type = e.target.value;
    renderTransactions();
  });
  $('f-status').addEventListener('change', function(e){
    filters.status = e.target.value;
    renderTransactions();
  });
  $('f-cat').addEventListener('change', function(e){
    filters.cat = e.target.value;
    renderTransactions();
  });

  document.addEventListener('change', function(e){
    if (e.target.id === 'goalInput') {
      state.settings.savingsGoal = parseAmount(e.target.value);
      saveState();
      render();
      toast(state.settings.savingsGoal > 0 ? 'Meta de economia atualizada' : 'Meta removida');
      return;
    }
    const budgetInput = e.target.closest('.budget-input');
    if (budgetInput) {
      const v = parseAmount(budgetInput.value);
      if (v > 0) state.budgets[budgetInput.dataset.cat] = v;
      else delete state.budgets[budgetInput.dataset.cat];
      saveState();
      render();
      toast(v > 0 ? 'Orçamento atualizado' : 'Limite removido');
    }
  });

  $('cardForm').addEventListener('submit', function(e){
    e.preventDefault();
    const name = $('c-name').value.trim() || 'Carrefour';
    const limit = parseAmount($('c-limit').value);
    const alertPct = Math.min(100, Math.max(50, parseInt($('c-alert').value, 10) || 80));
    const closingDay = Math.min(31, Math.max(1, parseInt($('c-closing').value, 10) || 30));
    const dueDay = Math.min(31, Math.max(1, parseInt($('c-due').value, 10) || 5));

    let card = primaryCard();
    if (card) {
      card.name = name;
      card.limit = limit;
      card.closingDay = closingDay;
      card.dueDay = dueDay;
    } else {
      card = { id: uid(), name: name, limit: limit, closingDay: closingDay, dueDay: dueDay };
      state.cards = [card];
    }
    state.settings.cardAlertPct = alertPct;

    cardEditMode = false;
    cardFormReady = false;
    cardViewMonth = null;
    saveState();
    render();
    toast('Cartão salvo');
  });

  $('recForm').addEventListener('submit', function(e){
    e.preventDefault();
    const desc = $('r-desc').value.trim();
    const type = $('r-type').value;
    const category = $('r-cat').value;
    const amount = parseAmount($('r-amount').value);
    const day = Math.min(31, Math.max(1, parseInt($('r-day').value, 10) || 1));
    const method = $('r-method').value || 'Pix';

    if (!desc) { toast('Informe uma descrição.'); return; }
    if (!(amount > 0)) { toast('Informe um valor maior que zero.'); return; }
    if (!category) { toast('Escolha uma categoria.'); return; }

    const rec = {
      id: uid(),
      desc: desc,
      type: type === 'income' ? 'income' : 'expense',
      category: category,
      amount: amount,
      day: day,
      active: true,
      method: method
    };
    if (method === 'Crédito' && primaryCard()) rec.cardId = primaryCard().id;

    state.recurrings.push(rec);
    saveState();
    $('r-desc').value = '';
    $('r-amount').value = '';
    $('r-day').value = '5';
    render();
    toast(method === 'Crédito' ? 'Conta fixa adicionada no cartão' : 'Conta fixa adicionada');
  });

  $('r-type').addEventListener('change', function(e){
    $('r-cat').value = e.target.value === 'income' ? 'salario' : 'moradia';
  });

  $('exportJson').addEventListener('click', exportJson);
  $('exportCsv').addEventListener('click', exportCsv);
  $('importBtn').addEventListener('click', function(){ $('importFile').click(); });
  $('importFile').addEventListener('change', function(e){
    const file = e.target.files && e.target.files[0];
    if (file) importJson(file);
    e.target.value = '';
  });

  $('demoBtn').addEventListener('click', function(){
    if (!confirm('Carregar dados de exemplo? Isso substitui todos os dados atuais.')) return;
    state = buildDemoState();
    viewMonth = thisMonthKey();
    saveState();
    if (recStore()) recStore().clear();
    applyTheme();
    render();
    toast('Dados de exemplo carregados');
  });

  $('resetBtn').addEventListener('click', function(){
    if (!confirm('Apagar todos os lançamentos, orçamentos e contas fixas? Essa ação não pode ser desfeita.')) return;
    if (!confirm('Tem certeza? Recomendamos baixar um backup antes.')) return;
    try { localStorage.removeItem(STORE_KEY); } catch (err) {}
    if (recStore()) recStore().clear();
    state = defaultState();
    viewMonth = thisMonthKey();
    applyTheme();
    saveState();
    render();
    toast('Todos os dados foram apagados');
  });

  $('installBtn').addEventListener('click', function(){
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function(){
      deferredPrompt = null;
      $('installBtn').hidden = true;
    });
  });

  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = function(){
      if ((state.settings.theme || 'auto') === 'auto') applyTheme();
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  bindSync();
  bindReport();
  bindQuickAdd();
}

/* ---------- lançamento rápido ---------- */

const QUICK_KEY = 'fluxo.quick.v1';
let quickType = 'expense';
let quickMem = { catExpense: '', catIncome: '', method: '' };

function quickMemory(){
  try {
    const m = JSON.parse(localStorage.getItem(QUICK_KEY) || '{}') || {};
    return {
      catExpense: m.catExpense || '',
      catIncome: m.catIncome || '',
      method: m.method || ''
    };
  } catch (e) {
    return { catExpense: '', catIncome: '', method: '' };
  }
}

function saveQuickMemory(){
  try { localStorage.setItem(QUICK_KEY, JSON.stringify(quickMem)); } catch (e) { /* ignore */ }
}

function fillQuickCats(selected){
  const list = quickType === 'income' ? INCOME_CATS : EXPENSE_CATS;
  $('q-cat').innerHTML = list.map(function(c){
    return '<option value="' + c.id + '">' + c.name + '</option>';
  }).join('');
  if (selected && list.some(function(c){ return c.id === selected; })) $('q-cat').value = selected;
}

function setQuickType(type){
  quickType = type === 'income' ? 'income' : 'expense';
  $('qTypeExpense').setAttribute('aria-pressed', String(quickType === 'income' ? 'false' : 'true'));
  $('qTypeIncome').setAttribute('aria-pressed', String(quickType === 'income' ? 'true' : 'false'));
  fillQuickCats(quickType === 'income' ? quickMem.catIncome : quickMem.catExpense);
}

function bindQuickAdd(){
  if (!$('quickForm')) return;

  quickMem = quickMemory();
  quickType = 'expense';
  $('qTypeExpense').setAttribute('aria-pressed', 'true');
  $('qTypeIncome').setAttribute('aria-pressed', 'false');

  fillQuickCats(quickMem.catExpense);

  $('q-method').innerHTML = METHODS.map(function(m){
    return '<option value="' + m + '">' + m + '</option>';
  }).join('');
  if (quickMem.method && METHODS.indexOf(quickMem.method) >= 0) $('q-method').value = quickMem.method;

  $('qTypeExpense').addEventListener('click', function(){ setQuickType('expense'); });
  $('qTypeIncome').addEventListener('click', function(){ setQuickType('income'); });

  $('q-amount').addEventListener('blur', function(e){
    const v = parseAmount(e.target.value);
    if (v > 0) e.target.value = formatAmountInput(v);
  });

  // no celular, o "próximo" do teclado pula direto para o valor
  $('q-desc').addEventListener('keydown', function(e){
    if (e.key === 'Enter') {
      e.preventDefault();
      $('q-amount').focus();
    }
  });

  $('quickForm').addEventListener('submit', function(e){
    e.preventDefault();

    const desc = $('q-desc').value.trim();
    const amount = parseAmount($('q-amount').value);

    if (!desc) { toast('Escreva uma descrição.'); $('q-desc').focus(); return; }
    if (!(amount > 0)) { toast('Informe o valor.'); $('q-amount').focus(); return; }

    const category = $('q-cat').value;
    const method = $('q-method').value;

    let day = new Date().getDate();
    if (viewMonth !== thisMonthKey()) {
      day = Math.min(day, daysInMonth(viewMonth));
    }

    const quickCard = quickType === 'expense' && method === 'Crédito' ? primaryCard() : null;
    const quickTx = {
      id: uid(),
      type: quickType,
      desc: desc,
      category: category,
      amount: amount,
      date: dateForDay(viewMonth, day),
      method: method,
      note: '',
      paid: false,
      createdAt: Date.now()
    };
    if (quickCard) quickTx.cardId = quickCard.id;
    state.transactions.push(quickTx);

    saveState();

    if (quickType === 'income') quickMem.catIncome = category;
    else quickMem.catExpense = category;
    quickMem.method = method;
    saveQuickMemory();

    $('q-desc').value = '';
    $('q-amount').value = '';
    $('q-desc').focus();

    render();
    toast(quickType === 'income' ? 'Receita lançada' : 'Despesa lançada');
  });
}

/* ---------- relatório em PDF ---------- */

function reportMonths(){
  const set = new Set();
  state.transactions.forEach(function(t){ set.add(t.date.slice(0, 7)); });
  set.add(thisMonthKey());
  set.add(viewMonth);
  return Array.from(set).sort().reverse();
}

function renderReport(){
  const sel = $('reportMonthSelect');
  if (!sel) return;

  const meses = reportMonths();
  const atual = sel.value || viewMonth;
  sel.innerHTML = meses.map(function(mk){
    const nome = monthLong(mk);
    return '<option value="' + mk + '">' + nome.charAt(0).toUpperCase() + nome.slice(1) + '</option>';
  }).join('');

  if (meses.indexOf(atual) >= 0) sel.value = atual;
  else if (meses.indexOf(viewMonth) >= 0) sel.value = viewMonth;
}

function base64ToBlob(base64, mime){
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function deliverPdf(arquivo){
  const native = window.FluxoNative;
  if (native && native.isNative && native.saveFileBase64) {
    await native.saveFileBase64(arquivo.base64, arquivo.filename);
    return 'share';
  }

  const blob = base64ToBlob(arquivo.base64, arquivo.mime);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = arquivo.filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 800);
  return 'download';
}

async function gerarRelatorio(tipo){
  if (!window.FluxoReport) {
    toast('O gerador de relatório não carregou. Feche e abra o app.');
    return;
  }

  const sel = $('reportMonthSelect');
  const mk = (sel && sel.value) || viewMonth;
  const btn = tipo === 'year' ? $('reportYearBtn') : $('reportMonthBtn');
  const rotulo = btn.textContent;

  btn.disabled = true;
  btn.textContent = 'Gerando relatório...';
  await new Promise(function(r){ setTimeout(r, 40); });

  try {
    const arquivo = tipo === 'year'
      ? window.FluxoReport.year(Number(mk.slice(0, 4)))
      : window.FluxoReport.month(mk);

    const how = await deliverPdf(arquivo);
    toast(how === 'share' ? 'Relatório pronto para salvar ou compartilhar' : 'Relatório baixado');
  } catch (err) {
    toast('Não foi possível gerar o relatório.');
  } finally {
    btn.disabled = false;
    btn.textContent = rotulo;
  }
}

function bindReport(){
  if (!$('reportMonthBtn')) return;
  $('reportMonthBtn').addEventListener('click', function(){ gerarRelatorio('month'); });
  $('reportYearBtn').addEventListener('click', function(){ gerarRelatorio('year'); });
  $('reportMonthSelect').addEventListener('change', function(){
    const sel = $('reportMonthSelect');
    const nome = monthLong(sel.value);
    $('reportHint').textContent = 'Mês escolhido: ' + nome.charAt(0).toUpperCase() + nome.slice(1) +
      '. O relatório do ano usa ' + sel.value.slice(0, 4) + '.';
  });
}

/* ---------- sincronização (opcional) ---------- */

let syncInputsFilled = false;
let syncUiBound = false;

function syncTime(ts){
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function renderSync(){
  const sync = window.FluxoSync;
  const statusEl = $('syncStatus');
  if (!sync || !statusEl) return;

  const snap = sync.snapshot();
  statusEl.classList.remove('online', 'syncing', 'error');

  let texto = 'Sincronização desativada';
  if (snap.status === 'connecting') {
    statusEl.classList.add('syncing');
    texto = 'Conectando…';
  } else if (snap.status === 'syncing') {
    statusEl.classList.add('syncing');
    texto = 'Enviando alterações…';
  } else if (snap.status === 'online') {
    statusEl.classList.add('online');
    texto = 'Sincronizado' + (snap.lastSync ? ' · ' + syncTime(snap.lastSync) : '');
  } else if (snap.status === 'error') {
    statusEl.classList.add('error');
    texto = 'Sem sincronizar';
  }
  $('syncStatusText').textContent = texto;

  const conectado = snap.status === 'online' || snap.status === 'syncing';
  $('syncNow').hidden = !conectado;
  $('syncDisconnect').hidden = !snap.configured;
  $('syncInvite').hidden = !conectado;
  $('syncPaste').hidden = conectado;
  $('syncNewCode').hidden = snap.configured;
  $('syncConnect').textContent = snap.status === 'error' ? 'Tentar de novo' : 'Conectar';

  if (!syncInputsFilled && snap.configured) {
    syncInputsFilled = true;
    if (!$('syncCode').value) $('syncCode').value = snap.code;
  }

  const hint = $('syncHint');
  if (snap.status === 'error') {
    hint.textContent = snap.error + '\n\nConfira o código da casa: ele precisa ser exatamente igual nos dois aparelhos.';
  } else if (conectado) {
    hint.textContent = 'Código da casa: ' + snap.code + '\nPara usar no outro aparelho, toque em Copiar código e cole lá.';
  } else if (snap.configured) {
    hint.textContent = 'Código salvo. Toque em Conectar para sincronizar.';
  } else {
    hint.textContent = 'Primeiro aparelho (o que já tem os lançamentos): toque em Gerar código e conecte.\nSegundo aparelho: toque em Colar código (ou digite o mesmo código do primeiro).';
  }

  renderSyncChip(snap);
}

/* Chip do topo + faixa de aviso: o usuário nunca fica sem saber se está sincronizado. */
function renderSyncChip(snap){
  const chip = $('syncChip');
  const texto = $('syncChipText');
  if (!chip || !texto) return;

  chip.classList.remove('online', 'syncing', 'error');
  let rotulo = 'Só neste aparelho';
  let titulo = 'Sincronização desligada. Toque para conectar este aparelho.';

  if (snap.status === 'online') {
    chip.classList.add('online');
    rotulo = 'Sincronizado';
    titulo = 'Tudo sincronizado' + (snap.lastSync ? ' às ' + syncTime(snap.lastSync) : '') + '. Toque para atualizar agora.';
  } else if (snap.status === 'syncing' || snap.status === 'connecting') {
    chip.classList.add('syncing');
    rotulo = 'Sincronizando…';
    titulo = 'Enviando e recebendo alterações…';
  } else if (snap.status === 'error') {
    chip.classList.add('error');
    rotulo = 'Sem sincronizar';
    titulo = snap.error || 'Erro ao sincronizar. Toque para tentar de novo.';
  }

  texto.textContent = rotulo;
  chip.title = titulo;

  const banner = $('syncBanner');
  if (!banner) return;

  const dispensado = banner.dataset.dismissed === '1';
  const mostrar = (!snap.configured || snap.status === 'error') && !dispensado;
  banner.hidden = !mostrar;
  if (!mostrar) return;

  banner.classList.toggle('error', snap.status === 'error');
  $('syncBannerTitle').textContent = snap.status === 'error'
    ? 'Não consegui sincronizar'
    : 'Este aparelho não está sincronizando';
  $('syncBannerText').textContent = snap.status === 'error'
    ? (snap.error || 'Confira a internet e tente de novo.')
    : 'Os lançamentos feitos aqui não aparecem no outro aparelho.';
  $('syncBannerBtn').textContent = snap.status === 'error' ? 'Tentar de novo' : 'Conectar';
}

async function copyText(texto){
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch (err) { /* tenta o método antigo */ }

  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch (err) {
    return false;
  }
}

async function aplicarConvite(convite, automatico){
  const sync = window.FluxoSync;
  if (!sync) return;

  sync.setConfig(convite.url, convite.key, convite.code);
  syncInputsFilled = true;
  $('syncCode').value = convite.code;
  renderSync();
  if (!automatico) toast('Código aplicado — conectando…');

  const ok = await sync.connect();
  if (ok) toast('Sincronização ativada');
}

/* Código recebido por link (https://site/#casa=...) */
function conviteDaUrl(){
  const sync = window.FluxoSync;
  if (!sync) return;

  const fonte = (location.hash || '') + '&' + (location.search || '');
  const m = fonte.match(/(?:convite|casa)=([^&\s]+)/);
  if (!m) return;

  let texto = m[1];
  try { texto = decodeURIComponent(m[1]); } catch (e) { /* usa como veio */ }

  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }

  const convite = sync.parseInvite(texto);
  if (!convite) {
    irParaSync();
    $('syncCode').value = texto.slice(0, 40);
    toast('Código do link não reconhecido. ' + sync.explainInvite(texto));
    return;
  }

  // já está nesta mesma casa: nada a fazer
  if (sync.isConfigured() && sync.snapshot().code === convite.code) return;

  aplicarConvite(convite, true);
}

/* Limpa cache/service worker e recarrega: resolve app preso em versão antiga (comum no iPhone). */
async function forcarAtualizacao(){
  toast('Buscando a versão mais nova…');
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(function(r){ return r.unregister(); }));
    }
    if (window.caches && caches.keys) {
      const nomes = await caches.keys();
      await Promise.all(nomes.map(function(n){ return caches.delete(n); }));
    }
  } catch (e) { /* segue para recarregar */ }
  location.replace(location.pathname + '?atualizado=' + Date.now());
}

function bindSync(){
  const sync = window.FluxoSync;
  if (!sync) return;

  if (!syncUiBound) {
    syncUiBound = true;
    sync.onChange(function(){ renderSync(); });
  }

  $('syncNewCode').addEventListener('click', function(){
    let code = 'casa-';
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    $('syncCode').value = code;
    $('syncCode').focus();
    toast('Código gerado: use o mesmo nos dois aparelhos');
  });

  $('syncConnect').addEventListener('click', async function(){
    const code = $('syncCode').value.trim().toLowerCase();

    if (!code) {
      if (sync.isConfigured()) { await sync.connect(); return; }
      toast('Digite o código da casa.');
      $('syncCode').focus();
      return;
    }
    if (code.length < 6) {
      toast('O código da casa precisa ter pelo menos 6 caracteres.');
      $('syncCode').focus();
      return;
    }

    sync.setCode(code);
    const ok = await sync.connect();
    if (ok) toast('Sincronização ativada');
  });

  $('syncNow').addEventListener('click', function(){
    sync.syncNow();
  });

  $('syncInvite').addEventListener('click', async function(){
    const codigo = sync.inviteText();
    if (!codigo) {
      toast('Conecte primeiro para ter um código.');
      return;
    }

    if (window.FluxoNative && window.FluxoNative.isNative && window.FluxoNative.shareText) {
      try {
        await window.FluxoNative.shareText(codigo, 'Código do Fluxo');
        return;
      } catch (err) { /* segue para copiar */ }
    }

    const copiou = await copyText(codigo);
    if (copiou) toast('Código copiado: cole no outro aparelho');
    else window.prompt('Código da casa:', codigo);
  });

  $('syncPaste').addEventListener('click', async function(){
    let texto = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        texto = await navigator.clipboard.readText();
      }
    } catch (err) { texto = ''; }

    const convite = sync.parseInvite(texto);
    if (convite) {
      aplicarConvite(convite);
      return;
    }

    if (texto) $('syncCode').value = texto.trim().slice(0, 40);
    $('syncCode').focus();
    toast(texto ? sync.explainInvite(texto) : 'Nada copiado. Digite o código da casa.');
  });
  $('syncReload').addEventListener('click', forcarAtualizacao);

  $('syncDisconnect').addEventListener('click', async function(){
    if (!confirm('Desconectar a sincronização? Os dados continuam salvos neste aparelho.')) return;
    await sync.disconnect();
    syncInputsFilled = false;
    $('syncCode').value = '';
    renderSync();
    toast('Sincronização desligada');
  });

  $('syncChip').addEventListener('click', function(){
    if (!sync.isConfigured()) { irParaSync(); return; }
    if (sync.snapshot().status === 'error') { sync.connect(); return; }
    toast('Atualizando…');
    sync.syncNow().then(function(ok){
      render();
      toast(ok ? 'Tudo atualizado' : 'Não consegui atualizar agora');
    });
  });

  $('syncBannerBtn').addEventListener('click', function(){
    if (sync.isConfigured()) { sync.connect(); return; }
    irParaSync();
  });

  $('syncBannerClose').addEventListener('click', function(){
    const banner = $('syncBanner');
    banner.dataset.dismissed = '1';
    banner.hidden = true;
  });
}

/* Leva o usuário direto ao cartão de sincronização, com destaque. */
function irParaSync(){
  switchTab('dados');
  const card = $('syncCard');
  if (!card) return;
  try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { card.scrollIntoView(); }
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
  const alvo = $('syncPaste');
  if (alvo && !alvo.hidden) {
    try { alvo.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
}

/* ---------- init ---------- */

async function init(){
  loadState();
  try {
    const demoParam = new URLSearchParams(location.search).get('demo');
    if (demoParam === '1' && !state.transactions.length) {
      state = buildDemoState();
      saveState();
    }
  } catch (err) {}
  applyTheme();
  initNativeChrome();
  fillStaticSelects();
  bind();

  if (recStore()) {
    try { await recStore().load(); } catch (e) {}
  }

  render();
  switchTab('overview');

  if (window.FluxoSync) {
    document.addEventListener('fluxo:remote-change', function(){ render(); });
    window.FluxoSync.start();
    conviteDaUrl();
    // abrir o link do convite com o app já aberto (só muda o #hash) também conecta
    window.addEventListener('hashchange', conviteDaUrl);
  }

  registerServiceWorker();
  setupInstall();
  if (window.FluxoNative && window.FluxoNative.isNative) {
    window.FluxoNative.onBack(function(){
      if ($('modal').classList.contains('open')) {
        closeModal();
        return;
      }
      if (currentTab !== 'overview') {
        switchTab('overview');
        return;
      }
      window.FluxoNative.exitApp();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
