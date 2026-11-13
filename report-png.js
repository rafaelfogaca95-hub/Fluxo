'use strict';

/* ============================================================
   Fluxo — resumo do mês em PNG
   Desenha uma página única no canvas (sem bibliotecas externas)
   para gerar uma imagem simples de entender e fácil de enviar.
   O bloco do cartão de crédito fica em um painel separado.
   ============================================================ */

(function(){

  const W = 1080;          // largura lógica (a imagem sai com o dobro)
  const PAD = 64;
  const SCALE = 2;

  const COL = {
    ink: '#1B1A16',
    muted: '#6E6A5F',
    line: '#E2DED5',
    soft: '#F6F5F1',
    bar: '#ECE9E1',
    accent: '#0F7B5F',
    accentSoft: '#E4F3ED',
    red: '#C0392B',
    redSoft: '#FBEBE9',
    green: '#1F7F55',
    greenSoft: '#EAF5EF',
    amber: '#A9701A',
    amberSoft: '#FBF3E2',
    white: '#FFFFFF'
  };

  const FONT = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';

  /* ---------- formatação ---------- */

  function money(v){
    if (typeof fmtBRL === 'function') return fmtBRL(v);
    return 'R$ ' + (Number(v) || 0).toFixed(2);
  }

  function pct(part, total){
    if (!total) return '0%';
    const v = Math.round((part / total) * 1000) / 10;
    return v.toLocaleString('pt-BR') + '%';
  }

  function dateBr(iso){
    if (!iso || String(iso).length < 10) return '';
    return String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7);
  }

  function stamp(){
    const d = new Date();
    return d.toLocaleDateString('pt-BR') + ' às ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function upperFirst(s){
    s = String(s || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function catName(id){
    const c = (typeof catById === 'function') ? catById(id) : null;
    return c ? c.name : String(id || '');
  }

  /* ---------- motor de desenho (duas passadas: medir, depois pintar) ---------- */

  function makePainter(ctx){
    const m = document.createElement('canvas').getContext('2d');
    const p = { ctx: ctx || null, m: m, y: 0 };

    p.font = function(size, weight, family){
      const f = String(weight || 500) + ' ' + size + 'px ' + (family || FONT);
      m.font = f;
      if (p.ctx) p.ctx.font = f;
    };

    p.measure = function(str){
      return m.measureText(String(str == null ? '' : str)).width;
    };

    /* diminui a fonte até caber; deixa a fonte já ajustada */
    p.fitFont = function(str, maxW, size, weight, family){
      let s = size;
      p.font(s, weight, family);
      while (s > 13 && p.measure(str) > maxW) {
        s -= 1;
        p.font(s, weight, family);
      }
    };

    /* corta o texto com "…" para caber na largura */
    p.fit = function(str, maxW){
      let s = String(str == null ? '' : str);
      if (p.measure(s) <= maxW) return s;
      while (s.length > 1 && p.measure(s + '…') > maxW) s = s.slice(0, -1);
      return s.replace(/\s+$/, '') + '…';
    };

    p.text = function(str, x, y, color, align){
      if (!p.ctx) return;
      p.ctx.fillStyle = color || COL.ink;
      p.ctx.textAlign = align || 'left';
      p.ctx.fillText(String(str == null ? '' : str), x, y);
      p.ctx.textAlign = 'left';
    };

    p.rect = function(x, y, w, h, r, fill, stroke, lineWidth){
      if (!p.ctx) return;
      const c = p.ctx;
      const rr = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2));
      c.beginPath();
      c.moveTo(x + rr, y);
      c.lineTo(x + w - rr, y);
      c.quadraticCurveTo(x + w, y, x + w, y + rr);
      c.lineTo(x + w, y + h - rr);
      c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      c.lineTo(x + rr, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - rr);
      c.lineTo(x, y + rr);
      c.quadraticCurveTo(x, y, x + rr, y);
      c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = lineWidth || 1; c.stroke(); }
    };

    p.hline = function(x1, x2, y, color, lw){
      if (!p.ctx) return;
      p.ctx.strokeStyle = color || COL.line;
      p.ctx.lineWidth = lw || 1;
      p.ctx.beginPath();
      p.ctx.moveTo(x1, y);
      p.ctx.lineTo(x2, y);
      p.ctx.stroke();
    };

    p.dot = function(x, y, r, color){
      if (!p.ctx) return;
      p.ctx.beginPath();
      p.ctx.arc(x, y, r, 0, Math.PI * 2);
      p.ctx.fillStyle = color;
      p.ctx.fill();
    };

    return p;
  }

  /* ---------- dados do mês ---------- */

  function buildData(mk){
    const st = statsFor(mk);
    const tx = txByMonth(mk);

    const incomeCount = tx.filter(function(t){ return t.type === 'income'; }).length;
    const expenseCount = tx.length - incomeCount;

    const byCat = expenseByCat(mk);
    const catList = Object.keys(byCat).map(function(id){
      const c = (typeof catById === 'function') ? catById(id) : null;
      return { id: id, name: c ? c.name : id, color: (c && c.color) || COL.accent, amount: byCat[id] };
    }).sort(function(a, b){ return b.amount - a.amount; });

    const cats = catList.slice(0, 6);
    const otherCats = catList.slice(6);
    const otherTotal = round2(otherCats.reduce(function(s, c){ return s + c.amount; }, 0));

    const economy = st.income > 0 ? Math.round((st.balance / st.income) * 1000) / 10 : null;

    const card = (typeof primaryCard === 'function') ? primaryCard() : null;
    let inv = null;
    let limit = null;
    if (card) {
      const fatura = cardInvoice(mk, card);
      inv = {
        total: fatura.total,
        paidTotal: fatura.paidTotal,
        allPaid: fatura.allPaid,
        dueDate: fatura.dueDate,
        cardName: card.name
      };
      limit = cardLimitInfo(card);
    }

    const fixes = (state.recurrings || []).filter(function(r){
      return r && r.active && r.type !== 'income';
    });
    const fixesTotal = round2(fixes.reduce(function(s, r){ return s + (Number(r.amount) || 0); }, 0));
    const launched = fixes.filter(function(r){
      return state.transactions.some(function(t){
        return t.recurringId === r.id && String(t.date).slice(0, 7) === mk;
      });
    });
    const pendingFixes = fixes.filter(function(r){ return launched.indexOf(r) === -1; })
      .sort(function(a, b){ return (a.day || 1) - (b.day || 1); });

    const biggest = tx.filter(function(t){ return t.type !== 'income'; })
      .sort(function(a, b){ return b.amount - a.amount; })
      .slice(0, 5);

    const openList = tx.filter(function(t){ return t.type === 'expense' && !t.paid; })
      .sort(function(a, b){ return b.amount - a.amount; });

    return {
      mk: mk,
      monthLabel: upperFirst(monthLong(mk)),
      monthLower: monthLong(mk),
      stamp: stamp(),
      st: st,
      incomeCount: incomeCount,
      expenseCount: expenseCount,
      economy: economy,
      cats: cats,
      otherCats: otherCats,
      otherTotal: otherTotal,
      card: card,
      inv: inv,
      limit: limit,
      fixes: fixes,
      fixesTotal: fixesTotal,
      launched: launched,
      pendingFixes: pendingFixes,
      biggest: biggest,
      openList: openList
    };
  }

  /* ---------- blocos do relatório ---------- */

  function drawHeader(p, d){
    const HH = 196;
    if (p.ctx) {
      const g = p.ctx.createLinearGradient(0, 0, W, HH);
      g.addColorStop(0, '#12866A');
      g.addColorStop(1, '#0A5A46');
      p.rect(0, 0, W, HH, 0, g);
    }

    p.rect(PAD, 50, 94, 94, 26, COL.white);
    p.font(56, 700, SERIF);
    p.text('F', PAD + 47, 118, COL.accent, 'center');

    p.font(45, 700, SERIF);
    p.text('Fluxo', PAD + 122, 104, COL.white);
    p.font(22, 500);
    p.text('Resumo de gastos', PAD + 122, 140, 'rgba(255,255,255,.84)');

    p.font(33, 700, SERIF);
    p.text(d.monthLabel, W - PAD, 100, COL.white, 'right');
    p.font(19, 500);
    p.text('Gerado em ' + d.stamp, W - PAD, 136, 'rgba(255,255,255,.8)', 'right');

    p.y = HH;
  }

  function drawKpis(p, d){
    p.y += 40;
    const gap = 26;
    const w = (W - PAD * 2 - gap * 2) / 3;
    const h = 158;

    const items = [
      { label: 'ENTROU', value: money(d.st.income), color: COL.green,
        note: d.incomeCount + (d.incomeCount === 1 ? ' receita' : ' receitas') },
      { label: 'SAIU', value: money(d.st.expense), color: COL.red,
        note: d.expenseCount + (d.expenseCount === 1 ? ' despesa' : ' despesas') },
      { label: 'SOBROU', value: money(d.st.balance), color: d.st.balance < 0 ? COL.red : COL.accent,
        note: d.economy == null ? 'sem receitas no mês' : d.economy.toLocaleString('pt-BR') + '% da renda' }
    ];

    items.forEach(function(it, i){
      const x = PAD + i * (w + gap);
      p.rect(x, p.y, w, h, 22, COL.soft);
      p.font(18, 700);
      p.text(it.label, x + 26, p.y + 40, COL.muted);
      p.fitFont(it.value, w - 52, 37, 700);
      p.text(it.value, x + 26, p.y + 96, it.color);
      p.font(18, 500);
      p.text(p.fit(it.note, w - 52), x + 26, p.y + 132, COL.muted);
    });

    p.y += h;
  }

  function drawOpenStrip(p, d){
    p.y += 24;
    const h = 92;
    const has = d.st.openCount > 0;

    p.rect(PAD, p.y, W - PAD * 2, h, 20, has ? COL.amberSoft : COL.greenSoft);
    p.dot(PAD + 38, p.y + h / 2, 8, has ? COL.amber : COL.green);

    const txt = has
      ? 'Em aberto: ' + money(d.st.openExpense) + ' em ' + d.st.openCount + (d.st.openCount === 1 ? ' despesa' : ' despesas')
      : 'Tudo pago neste mês';

    p.font(23, 600);
    p.text(txt, PAD + 62, p.y + 55, has ? COL.amber : COL.green);

    p.y += h;
  }

  function section(p, title, right){
    p.y += 44;
    p.font(27, 700);
    p.text(title, PAD, p.y, COL.ink);
    if (right) {
      p.font(19, 600);
      p.text(right, W - PAD, p.y, COL.muted, 'right');
    }
    p.hline(PAD, W - PAD, p.y + 15, COL.line, 2);
    p.y += 32;
  }

  /* painel do cartão: fica destacado, separado das outras informações */
  function drawCardPanel(p, d){
    if (!d.card || !d.inv) return;

    const inv = d.inv;
    p.y += 44;

    const x = PAD;
    const w = W - PAD * 2;
    const h = 306;
    const ix = x + 50;
    const ir = x + w - 30;

    p.rect(x, p.y, w, h, 24, COL.soft, COL.line, 1.5);
    p.rect(x + 20, p.y + 26, 8, h - 52, 4, COL.accent);

    p.font(19, 700);
    p.text('CARTÃO DE CRÉDITO', ix, p.y + 46, COL.accent);
    p.font(21, 600);
    p.text(p.fit(inv.cardName, 300), ir, p.y + 46, COL.ink, 'right');

    p.font(23, 500);
    p.text('Fatura de ' + d.monthLower, ix, p.y + 96, COL.muted);
    p.fitFont(money(inv.total), 380, 35, 700);
    p.text(money(inv.total), ir, p.y + 100, COL.ink, 'right');

    const due = inv.dueDate ? dateBr(inv.dueDate) : '';
    let statusTxt;
    let statusColor;
    if (inv.total <= 0) {
      statusTxt = 'Sem compras nesta fatura';
      statusColor = COL.muted;
    } else if (inv.allPaid) {
      statusTxt = 'Fatura paga';
      statusColor = COL.green;
    } else {
      statusTxt = money(inv.total - inv.paidTotal) + ' em aberto';
      statusColor = COL.red;
    }

    p.font(20, 500);
    if (due) {
      p.text('Vence ' + due, ix, p.y + 136, COL.muted);
      p.text(statusTxt, ix + p.measure('Vence ' + due) + 16, p.y + 136, statusColor);
    } else {
      p.text(statusTxt, ix, p.y + 136, statusColor);
    }

    const info = d.limit;
    const hasLimit = !!(info && info.limit > 0);

    p.font(19, 500);
    p.text('Limite comprometido', ix, p.y + 186, COL.muted);
    p.font(19, 700);
    p.text(hasLimit ? money(info.used) + ' de ' + money(info.limit) : 'Limite não informado',
      ir, p.y + 186, COL.ink, 'right');

    const barY = p.y + 202;
    const barW = ir - ix;
    p.rect(ix, barY, barW, 16, 8, '#E6E3DB');
    if (hasLimit) {
      p.rect(ix + 2, barY + 2, Math.max(6, (barW - 4) * Math.min(1, info.used / info.limit)), 12, 6,
        info.pct >= 80 ? COL.red : COL.amber);
    }

    p.font(19, 500);
    p.text(hasLimit ? 'Disponível ' + money(info.available) : '', ix, p.y + 252, COL.muted);
    p.font(19, 700);
    p.text(hasLimit ? info.pct + '% do limite usado' : '', ir, p.y + 252,
      info.pct >= 80 ? COL.red : COL.muted, 'right');

    p.font(17, 500);
    p.text('Fecha dia ' + (d.card.closingDay || 30) + ' · vence dia ' + (d.card.dueDay || 5) +
      ' · compras do cartão já estão nas despesas do mês.', ix, p.y + 282, COL.muted);

    p.y += h;
  }

  function drawCategories(p, d){
    if (!d.cats.length) return;

    section(p, 'Para onde foi o dinheiro', money(d.st.expense));

    const full = W - PAD * 2;
    const max = d.cats[0].amount || 1;

    d.cats.forEach(function(c){
      p.font(23, 700);
      const amount = money(c.amount);
      const aw = p.measure(amount);

      p.font(23, 600);
      const name = p.fit(c.name, full - aw - 64);
      p.text(name, PAD, p.y + 24, COL.ink);

      const nw = p.measure(name);
      p.font(19, 500);
      const share = pct(c.amount, d.st.expense) + ' das despesas';
      if (PAD + nw + 12 + p.measure(share) < W - PAD - aw - 24) {
        p.text(share, PAD + nw + 12, p.y + 24, COL.muted);
      }

      p.font(23, 700);
      p.text(amount, W - PAD, p.y + 24, COL.ink, 'right');

      p.rect(PAD, p.y + 40, full, 14, 7, COL.bar);
      p.rect(PAD, p.y + 40, Math.max(10, full * (c.amount / max)), 14, 7, c.color);

      p.y += 74;
    });

    if (d.otherCats.length) {
      p.font(19, 500);
      p.text('+ ' + d.otherCats.length + (d.otherCats.length === 1 ? ' categoria' : ' categorias') +
        ' · ' + money(d.otherTotal), PAD, p.y + 10, COL.muted);
      p.y += 34;
    }
  }

  function drawFixed(p, d){
    if (!d.fixes.length) return;

    section(p, 'Contas fixas', d.fixes.length + ' contas · ' + money(d.fixesTotal) + '/mês');

    if (!d.pendingFixes.length) {
      p.font(21, 600);
      p.text('Todas as contas fixas do mês já foram lançadas.', PAD, p.y + 8, COL.green);
      p.y += 44;
      return;
    }

    d.pendingFixes.slice(0, 5).forEach(function(r){
      p.font(22, 500);
      p.text(p.fit(r.desc, W - PAD * 2 - 230), PAD, p.y + 22, COL.ink);
      p.font(22, 600);
      p.text(money(r.amount), W - PAD, p.y + 22, COL.ink, 'right');
      p.font(18, 500);
      p.text('a lançar · todo dia ' + r.day, PAD, p.y + 44, COL.muted);
      p.y += 62;
    });

    if (d.pendingFixes.length > 5) {
      p.font(18, 500);
      p.text('+ ' + (d.pendingFixes.length - 5) + ' contas a lançar', PAD, p.y + 10, COL.muted);
      p.y += 32;
    }

    p.font(18, 500);
    p.text(d.launched.length + ' de ' + d.fixes.length + ' já lançadas neste mês', PAD, p.y + 10, COL.muted);
    p.y += 34;
  }

  function drawBiggest(p, d){
    if (!d.biggest.length) return;

    section(p, 'Maiores gastos', 'top ' + d.biggest.length);

    d.biggest.forEach(function(t){
      p.font(19, 500);
      p.text(dateBr(t.date), PAD, p.y + 21, COL.muted);

      p.font(22, 500);
      p.text(p.fit(t.desc, W - PAD * 2 - 76 - 200), PAD + 76, p.y + 21, COL.ink);

      p.font(22, 600);
      p.text(money(t.amount), W - PAD, p.y + 21, COL.ink, 'right');

      p.y += 52;
    });
  }

  function drawOpenList(p, d){
    if (!d.openList.length) return;

    section(p, 'Ainda em aberto', money(d.st.openExpense));

    d.openList.slice(0, 6).forEach(function(t){
      p.font(22, 500);
      p.text(p.fit(t.desc, W - PAD * 2 - 210), PAD, p.y + 21, COL.ink);
      p.font(22, 700);
      p.text(money(t.amount), W - PAD, p.y + 21, COL.amber, 'right');
      p.font(18, 500);
      p.text(dateBr(t.date) + ' · ' + catName(t.category), PAD, p.y + 43, COL.muted);
      p.y += 58;
    });

    if (d.openList.length > 6) {
      p.font(18, 500);
      p.text('+ ' + (d.openList.length - 6) + ' lançamentos em aberto', PAD, p.y + 8, COL.muted);
      p.y += 32;
    }
  }

  function drawEmpty(p, d){
    p.y += 44;
    p.rect(PAD, p.y, W - PAD * 2, 150, 20, COL.soft);
    p.font(24, 600);
    p.text('Nenhum lançamento em ' + d.monthLower + '.', PAD + 30, p.y + 64, COL.ink);
    p.font(19, 500);
    p.text('Adicione receitas e despesas no app e gere o resumo de novo.', PAD + 30, p.y + 102, COL.muted);
    p.y += 150;
  }

  function drawFooter(p, d){
    p.y += 46;
    p.hline(PAD, W - PAD, p.y, COL.line, 2);
    p.y += 30;

    p.font(17, 500);
    p.text('Fluxo · resumo gerado no aparelho', PAD, p.y, COL.muted);
    p.text('Página única · ' + d.stamp, W - PAD, p.y, COL.muted, 'right');

    p.y += 40;
  }

  function drawReport(p, d){
    drawHeader(p, d);
    drawKpis(p, d);
    drawOpenStrip(p, d);

    if (!d.st.count) {
      drawEmpty(p, d);
    } else {
      drawCardPanel(p, d);
      drawCategories(p, d);
      drawFixed(p, d);
      drawBiggest(p, d);
      drawOpenList(p, d);
    }

    drawFooter(p, d);
  }

  /* ---------- geração da imagem ---------- */

  function renderMonth(mk){
    const alvo = mk || (typeof viewMonth === 'string' ? viewMonth : thisMonthKey());
    const d = buildData(alvo);

    // 1ª passada: só mede a altura necessária
    const medida = makePainter(null);
    drawReport(medida, d);
    const height = Math.ceil(medida.y);

    // 2ª passada: desenha de verdade
    const canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = Math.max(height, 400) * SCALE;

    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COL.white;
    ctx.fillRect(0, 0, W, height);

    drawReport(makePainter(ctx), d);

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.indexOf('base64,') >= 0 ? dataUrl.split('base64,')[1] : '';

    return {
      dataUrl: dataUrl,
      base64: base64,
      filename: 'fluxo-resumo-' + alvo + '.png',
      mime: 'image/png',
      width: canvas.width,
      height: canvas.height,
      month: alvo,
      label: d.monthLabel
    };
  }

  window.FluxoReportPng = {
    month: renderMonth,
    data: buildData
  };

})();
