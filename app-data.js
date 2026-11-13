'use strict';

/* ============================================================
   Fluxo — camada de dados
   ============================================================ */

const STORE_KEY = 'fluxo.financas.v1';

const EXPENSE_CATS = [
  { id:'moradia',     name:'Moradia',     icon:'🏠', color:'#A9663F' },
  { id:'alimentacao', name:'Alimentação', icon:'🍽️', color:'#5B8C5A' },
  { id:'transporte',  name:'Transporte',  icon:'🚗', color:'#3F7EA6' },
  { id:'saude',       name:'Saúde',       icon:'💊', color:'#C2556B' },
  { id:'lazer',       name:'Lazer',       icon:'🎮', color:'#8B6BC4' },
  { id:'educacao',    name:'Educação',    icon:'📚', color:'#3E8E82' },
  { id:'compras',     name:'Compras',     icon:'🛍️', color:'#C08A2E' },
  { id:'assinaturas', name:'Assinaturas', icon:'📺', color:'#7C5CF0' },
  { id:'contas',      name:'Contas',      icon:'🧾', color:'#5B6472' },
  { id:'pets',        name:'Pets',        icon:'🐾', color:'#B0785A' },
  { id:'outros',      name:'Outros',      icon:'📦', color:'#8A867D' }
];

const INCOME_CATS = [
  { id:'salario',       name:'Salário',       icon:'💼', color:'#2E9E6B' },
  { id:'freelance',     name:'Freelance',     icon:'💻', color:'#3F7EA6' },
  { id:'investimentos', name:'Investimentos', icon:'📈', color:'#B08A2E' },
  { id:'vendas',        name:'Vendas',        icon:'🏷️', color:'#8B6BC4' },
  { id:'outras-receitas', name:'Outras receitas', icon:'💰', color:'#8A867D' }
];

const ALL_CATS = EXPENSE_CATS.concat(INCOME_CATS);

const METHODS = ['Pix', 'Débito', 'Crédito', 'Dinheiro', 'Boleto', 'Transferência'];
const MONTHS_LONG = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MONTHS_SHORT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

let state = defaultState();
let viewMonth = thisMonthKey();
let currentTab = 'overview';
let filters = { q:'', type:'', status:'', cat:'' };
let modalType = 'expense';
let editingId = null;

/* ---------- utilidades ---------- */

function defaultState(){
  return {
    version: 1,
    transactions: [],
    budgets: {},
    recurrings: [],
    cards: [],
    settings: { theme: 'auto', savingsGoal: 0, cardAlertPct: 80 }
  };
}

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pad2(n){ return String(n).padStart(2, '0'); }

function todayIso(){
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function thisMonthKey(){
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

function monthKey(date){
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1);
}

function shiftMonth(mk, delta){
  const p = mk.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1 + delta, 1);
  return monthKey(d);
}

function monthLong(mk){
  const p = mk.split('-').map(Number);
  return MONTHS_LONG[p[1] - 1] + ' de ' + p[0];
}

function monthShort(mk){
  const p = mk.split('-').map(Number);
  return MONTHS_SHORT[p[1] - 1];
}

function daysInMonth(mk){
  const p = mk.split('-').map(Number);
  return new Date(p[0], p[1], 0).getDate();
}

function dateForDay(mk, day){
  const max = daysInMonth(mk);
  const d = Math.min(Math.max(1, parseInt(day, 10) || 1), max);
  return mk + '-' + pad2(d);
}

function fmtBRL(v){
  const n = Number(v) || 0;
  const s = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-R$ ' : 'R$ ') + s;
}

function fmtCompact(v){
  const n = Math.abs(Number(v) || 0);
  if (n >= 1000000) return 'R$ ' + (n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (n >= 1000) return 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return 'R$ ' + Math.round(n).toLocaleString('pt-BR');
}

function fmtPlain(v){
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatAmountInput(v){
  return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseAmount(value){
  if (typeof value === 'number') return Math.abs(value) || 0;
  let s = String(value == null ? '' : value).trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastComma > lastDot){
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > -1 && lastComma > -1){
    s = s.replace(/,/g, '');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)){
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100) / 100;
}

function fmtDate(iso){
  if (!iso || iso.length < 10) return '';
  return iso.slice(8, 10) + '/' + iso.slice(5, 7);
}

function fmtDateFull(iso){
  if (!iso || iso.length < 10) return '';
  return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
}

function catById(id){
  return ALL_CATS.find(function(c){ return c.id === id; }) || { id:id, name:'Outros', icon:'📦', color:'#8A867D' };
}

function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

/* ---------- persistência ---------- */

function saveState(opts){
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (!(opts && opts.silent)) {
      document.dispatchEvent(new CustomEvent('fluxo:state-saved'));
    }
    return true;
  } catch (e) {
    if (typeof toast === 'function') toast('Não foi possível salvar os dados neste navegador.');
    return false;
  }
}

function loadState(){
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = normalizeState(JSON.parse(raw));
  } catch (e) {
    console.warn('Falha ao carregar dados salvos:', e);
    state = defaultState();
  }
  if (!state.settings) state.settings = defaultState().settings;
}

function normalizeState(raw){
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const out = Object.assign(base, {
    version: 1,
    settings: Object.assign({}, base.settings, raw.settings || {})
  });

  out.transactions = (Array.isArray(raw.transactions) ? raw.transactions : [])
    .filter(function(t){ return t && t.id && t.date && t.desc; })
    .map(function(t){
      const tx = {
        id: String(t.id),
        type: t.type === 'income' ? 'income' : 'expense',
        desc: String(t.desc).slice(0, 120),
        category: String(t.category || 'outros'),
        amount: Math.round((Math.abs(Number(t.amount)) || 0) * 100) / 100,
        date: String(t.date).slice(0, 10),
        method: t.method ? String(t.method) : 'Pix',
        note: t.note ? String(t.note).slice(0, 200) : '',
        paid: t.paid === true,
        paidAt: Number(t.paidAt) || 0
      };
      if (t.recurringId) tx.recurringId = String(t.recurringId);
      if (t.cardId) tx.cardId = String(t.cardId);
      if (Number(t.deferDays) > 0) tx.deferDays = Math.min(365, Math.round(Number(t.deferDays)));
      if (t.installment && typeof t.installment === 'object'){
        const total = Math.min(48, Math.max(1, parseInt(t.installment.total, 10) || 1));
        const index = Math.min(total, Math.max(1, parseInt(t.installment.index, 10) || 1));
        if (total > 1 && t.installment.groupId) {
          tx.installment = { index: index, total: total, groupId: String(t.installment.groupId) };
        }
      }
      if (t.createdAt) tx.createdAt = Number(t.createdAt) || 0;
      return tx;
    })
    .filter(function(t){ return /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.amount > 0; });

  out.budgets = {};
  if (raw.budgets && typeof raw.budgets === 'object'){
    Object.keys(raw.budgets).forEach(function(k){
      const v = Math.round((Number(raw.budgets[k]) || 0) * 100) / 100;
      if (v > 0) out.budgets[k] = v;
    });
  }

  out.recurrings = (Array.isArray(raw.recurrings) ? raw.recurrings : [])
    .filter(function(r){ return r && r.id && r.desc; })
    .map(function(r){
      const rec = {
        id: String(r.id),
        desc: String(r.desc).slice(0, 80),
        type: r.type === 'income' ? 'income' : 'expense',
        category: String(r.category || 'outros'),
        amount: Math.round((Math.abs(Number(r.amount)) || 0) * 100) / 100,
        day: Math.min(31, Math.max(1, parseInt(r.day, 10) || 1)),
        active: r.active !== false,
        method: r.method ? String(r.method) : 'Pix'
      };
      if (r.cardId) rec.cardId = String(r.cardId);
      return rec;
    })
    .filter(function(r){ return r.amount > 0; });

  out.cards = (Array.isArray(raw.cards) ? raw.cards : [])
    .filter(function(c){ return c && c.name; })
    .slice(0, 4)
    .map(function(c){
      return {
        id: String(c.id || uid()),
        name: String(c.name).slice(0, 40),
        limit: Math.round((Math.abs(Number(c.limit)) || 0) * 100) / 100,
        closingDay: Math.min(31, Math.max(1, parseInt(c.closingDay, 10) || 1)),
        dueDay: Math.min(31, Math.max(1, parseInt(c.dueDay, 10) || 1))
      };
    });

  const alertPct = Number(out.settings.cardAlertPct);
  out.settings.cardAlertPct = alertPct >= 50 && alertPct <= 100 ? Math.round(alertPct) : 80;
  out.settings.savingsGoal = Math.max(0, Number(out.settings.savingsGoal) || 0);
  if (typeof out.settings.theme !== 'string') out.settings.theme = 'auto';

  return out;
}

/* ---------- consultas ---------- */

function txByMonth(mk){
  return state.transactions.filter(function(t){ return t.date.slice(0, 7) === mk; });
}

function sortedTx(list){
  return list.slice().sort(function(a, b){
    return b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function statsFor(mk){
  const tx = txByMonth(mk);
  let income = 0;
  let expense = 0;
  let openExpense = 0;
  let openCount = 0;
  tx.forEach(function(t){
    if (t.type === 'income') {
      income += t.amount;
    } else {
      expense += t.amount;
      if (!t.paid) {
        openExpense += t.amount;
        openCount += 1;
      }
    }
  });
  return {
    tx: tx,
    count: tx.length,
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    balance: Math.round((income - expense) * 100) / 100,
    openExpense: Math.round(openExpense * 100) / 100,
    openCount: openCount
  };
}

function txIsPaid(t){
  return !!(t && t.paid);
}

function setTransactionPaid(id, paid){
  const t = state.transactions.find(function(x){ return x.id === id; });
  if (!t) return false;
  t.paid = !!paid;
  t.paidAt = paid ? Date.now() : 0;
  saveState();
  return true;
}

function expenseByCat(mk){
  const map = {};
  txByMonth(mk).forEach(function(t){
    if (t.type !== 'expense') return;
    map[t.category] = (map[t.category] || 0) + t.amount;
  });
  return map;
}

/* ---------- cartão ---------- */

function round2(v){
  return Math.round((Number(v) || 0) * 100) / 100;
}

function primaryCard(){
  return (state.cards && state.cards[0]) || null;
}

function cardById(id){
  if (!id) return null;
  return (state.cards || []).find(function(c){ return c.id === id; }) || null;
}

function addDaysIso(iso, days){
  const d = new Date(String(iso) + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function txCard(t){
  return (t && t.cardId ? cardById(t.cardId) : null) || primaryCard();
}

/* Mês da fatura em que a compra cai.
   Compra até o dia do fechamento entra na fatura do próprio mês; depois, na seguinte.
   Compra adiada (ex.: 90 dias) usa a data do vencimento adiado como base. */
function txInvoiceMonth(t, card){
  card = card || txCard(t);
  if (!card) return String(t.date).slice(0, 7);
  const base = t.deferDays ? addDaysIso(t.date, t.deferDays) : t.date;
  const mk = base.slice(0, 7);
  const day = parseInt(base.slice(8, 10), 10) || 1;
  return day <= card.closingDay ? mk : shiftMonth(mk, 1);
}

function invoiceDueDate(card, mk){
  if (!card) return '';
  const dueMonth = card.dueDay > card.closingDay ? mk : shiftMonth(mk, 1);
  return dateForDay(dueMonth, card.dueDay);
}

/* Fatura "atual": a primeira cujo vencimento ainda não passou. */
function currentInvoiceMonth(card){
  card = card || primaryCard();
  const today = todayIso();
  if (!card) return today.slice(0, 7);
  const mk0 = today.slice(0, 7);
  const candidatos = [shiftMonth(mk0, -1), mk0, shiftMonth(mk0, 1)];
  for (let i = 0; i < candidatos.length; i++) {
    const due = invoiceDueDate(card, candidatos[i]);
    if (due && due >= today) return candidatos[i];
  }
  return txInvoiceMonth({ date: today }, card);
}

function cardInvoice(mk, card){
  card = card || primaryCard();
  const items = state.transactions
    .filter(function(t){ return !!t.cardId && t.type === 'expense' && txInvoiceMonth(t, card) === mk; })
    .sort(function(a, b){ return a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0); });

  const total = round2(items.reduce(function(s, t){ return s + t.amount; }, 0));
  const paidTotal = round2(items.reduce(function(s, t){ return s + (txIsPaid(t) ? t.amount : 0); }, 0));
  const allPaid = items.length > 0 && items.every(txIsPaid);

  return {
    month: mk,
    items: items,
    total: total,
    paidTotal: paidTotal,
    allPaid: allPaid,
    dueDate: invoiceDueDate(card, mk)
  };
}

/* Limite comprometido: compras no cartão ainda não pagas (de qualquer fatura). */
function cardCommitted(card){
  card = card || primaryCard();
  return round2((state.transactions || []).filter(function(t){
    return !!t.cardId && t.type === 'expense' && !txIsPaid(t);
  }).reduce(function(s, t){ return s + t.amount; }, 0));
}

function cardLimitInfo(card){
  card = card || primaryCard();
  const limit = card ? card.limit : 0;
  const used = cardCommitted(card);
  const available = Math.max(0, round2(limit - used));
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return { limit: limit, used: used, available: available, pct: pct };
}

function cardFixedMonthly(card){
  card = card || primaryCard();
  return round2((state.recurrings || []).filter(function(r){
    return r.active && r.type === 'expense' && r.method === 'Crédito' && (!r.cardId || !card || r.cardId === card.id);
  }).reduce(function(s, r){ return s + r.amount; }, 0));
}

function recurringDue(mk){
  return state.recurrings
    .filter(function(r){ return r.active; })
    .map(function(r){
      const launched = state.transactions.some(function(t){
        return t.recurringId === r.id && t.date.slice(0, 7) === mk;
      });
      return { rec: r, launched: launched, date: dateForDay(mk, r.day) };
    });
}

function pendingRecurrings(mk){
  return recurringDue(mk).filter(function(d){ return !d.launched; });
}

function launchRecurring(id){
  const r = state.recurrings.find(function(x){ return x.id === id; });
  if (!r || !r.active) return false;
  const already = state.transactions.some(function(t){
    return t.recurringId === r.id && t.date.slice(0, 7) === viewMonth;
  });
  if (already) return false;

  const tx = {
    id: uid(),
    type: r.type,
    desc: r.desc,
    category: r.category,
    amount: r.amount,
    date: dateForDay(viewMonth, r.day),
    method: r.method || 'Pix',
    note: '',
    recurringId: r.id,
    createdAt: Date.now()
  };
  if (r.method === 'Crédito') {
    const card = cardById(r.cardId) || primaryCard();
    if (card) tx.cardId = card.id;
  }
  state.transactions.push(tx);
  saveState();
  return true;
}

function launchAllPending(){
  const pending = pendingRecurrings(viewMonth);
  pending.forEach(function(d){ launchRecurring(d.rec.id); });
  return pending.length;
}

function deleteTransaction(id){
  const before = state.transactions.length;
  state.transactions = state.transactions.filter(function(t){ return t.id !== id; });
  saveState();
  return state.transactions.length < before;
}

/* ---------- dados de exemplo ---------- */

function buildDemoState(){
  const rand = (function(seed){
    let s = seed;
    return function(){
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  })(20261111);

  const now = new Date();
  const tx = [];
  const mkOf = function(d){ return d.getFullYear() + '-' + pad2(d.getMonth() + 1); };
  const push = function(type, desc, category, amount, mk, day, method, recurringId){
    tx.push({
      id: uid() + '-' + tx.length,
      type: type,
      desc: desc,
      category: category,
      amount: Math.round(amount * 100) / 100,
      date: dateForDay(mk, day),
      method: method || 'Pix',
      note: '',
      paid: mk !== currentMk || rand() > 0.5,
      createdAt: Date.now() - (100000 - tx.length * 100),
      ...(recurringId ? { recurringId: recurringId } : {}),
      ...((method || 'Pix') === 'Crédito' ? { cardId: 'demo-card' } : {})
    });
  };

  const recs = [
    { id:'demo-aluguel',  desc:'Aluguel',            type:'expense', category:'moradia',     amount:1550, day:5,  method:'Boleto' },
    { id:'demo-energia',  desc:'Conta de energia',   type:'expense', category:'contas',      amount:186,  day:12, method:'Boleto' },
    { id:'demo-internet', desc:'Internet',           type:'expense', category:'contas',      amount:119.9, day:10, method:'Boleto' },
    { id:'demo-stream',   desc:'Streaming',          type:'expense', category:'assinaturas', amount:55.8, day:20, method:'Crédito' },
    { id:'demo-academia', desc:'Academia',           type:'expense', category:'saude',       amount:129,  day:8,  method:'Débito' }
  ];

  const variable = [
    ['Supermercado', 'alimentacao', 180, 340, 'Débito'],
    ['Feira da semana', 'alimentacao', 60, 110, 'Dinheiro'],
    ['Restaurante', 'alimentacao', 45, 120, 'Crédito'],
    ['Combustível', 'transporte', 160, 260, 'Débito'],
    ['App de transporte', 'transporte', 22, 65, 'Crédito'],
    ['Farmácia', 'saude', 35, 95, 'Débito'],
    ['Cinema', 'lazer', 40, 90, 'Crédito'],
    ['Bar com amigos', 'lazer', 60, 150, 'Pix'],
    ['Livro', 'educacao', 45, 110, 'Crédito'],
    ['Roupa', 'compras', 90, 260, 'Crédito'],
    ['Presente', 'compras', 50, 160, 'Pix'],
    ['Ração e petisco', 'pets', 70, 160, 'Débito']
  ];

  const currentMk = mkOf(now);

  for (let i = 4; i >= 0; i--){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mk = mkOf(d);

    push('income', 'Salário', 'salario', 4200, mk, 5, 'Transferência');
    if (rand() > 0.4){
      push('income', 'Freelance', 'freelance', 350 + Math.round(rand() * 900), mk, 15, 'Pix');
    }
    if (i === 2){
      push('income', 'Venda de usados', 'vendas', 320, mk, 22, 'Pix');
    }

    // contas fixas: nos meses passados já foram lançadas; no mês atual ficam pendentes
    if (mk !== currentMk){
      recs.forEach(function(r){ push(r.type, r.desc, r.category, r.amount, mk, r.day, r.method, r.id); });
    }

    const qty = 9 + Math.floor(rand() * 5);
    for (let k = 0; k < qty; k++){
      const item = variable[Math.floor(rand() * variable.length)];
      const value = item[2] + rand() * (item[3] - item[2]);
      const day = 1 + Math.floor(rand() * daysInMonth(mk));
      push('expense', item[0], item[1], value, mk, day, item[4]);
    }
  }

  return {
    version: 1,
    transactions: tx,
    budgets: {
      moradia: 1900,
      alimentacao: 1100,
      transporte: 450,
      saude: 300,
      lazer: 350,
      educacao: 150,
      compras: 400,
      assinaturas: 150,
      contas: 400,
      pets: 200
    },
    recurrings: recs.map(function(r){
      const rec = { id:r.id, desc:r.desc, type:r.type, category:r.category, amount:r.amount, day:r.day, active:true, method:r.method };
      if (r.method === 'Crédito') rec.cardId = 'demo-card';
      return rec;
    }),
    cards: [{ id:'demo-card', name:'Carrefour', limit:2500, closingDay:30, dueDay:5 }],
    settings: { theme: state.settings ? state.settings.theme : 'auto', savingsGoal: 700, cardAlertPct: 80 }
  };
}
