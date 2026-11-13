'use strict';

/* ============================================================
   Fluxo — relatório de gastos em PDF
   Usa o jsPDF empacotado localmente em report.js (window.FluxoPdf)
   ============================================================ */

(function(){

  const A4W = 210;
  const ML = 14;
  const MR = 14;
  const CW = A4W - ML - MR;
  const BOTTOM = 270;

  const C = {
    ink: [27, 26, 22],
    muted: [110, 106, 95],
    line: [226, 222, 213],
    soft: [246, 245, 241],
    accent: [15, 123, 95],
    red: [192, 57, 43],
    green: [31, 127, 85],
    white: [255, 255, 255]
  };

  function money(v){
    const n = Number(v) || 0;
    const s = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-R$ ' : 'R$ ') + s;
  }

  function pct(part, total){
    if (!total) return '-';
    const v = Math.round((part / total) * 1000) / 10;
    return v.toLocaleString('pt-BR') + '%';
  }

  function dateBr(iso){
    if (!iso) return '';
    return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  }

  function stamp(){
    const d = new Date();
    return d.toLocaleDateString('pt-BR') + ' às ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function catName(id){
    const c = (typeof catById === 'function') ? catById(id) : null;
    return c ? c.name : String(id || '');
  }

  /* texto que cabe na largura, com "..." no fim */
  function fit(doc, text, width){
    let t = String(text == null ? '' : text);
    if (doc.getTextWidth(t) <= width) return t;
    while (t.length > 3 && doc.getTextWidth(t + '...') > width) t = t.slice(0, -1);
    return t.replace(/\s+$/, '') + '...';
  }

  /* ---------- estrutura da página ---------- */

  function newDoc(){
    return new window.FluxoPdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  }

  function header(doc, periodo, geradoEm){
    doc.setFillColor.apply(doc, C.accent);
    doc.rect(0, 0, A4W, 32, 'F');

    doc.setFillColor.apply(doc, C.white);
    doc.roundedRect(ML, 8.5, 15, 15, 3.5, 3.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor.apply(doc, C.accent);
    doc.text('F', ML + 7.5, 19.4, { align: 'center' });

    doc.setTextColor.apply(doc, C.white);
    doc.setFontSize(17);
    doc.text('Fluxo', ML + 20, 16.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('Relatório de gastos', ML + 20, 22.3);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(periodo, A4W - MR, 16.5, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Gerado em ' + geradoEm, A4W - MR, 22.3, { align: 'right' });

    return 42;
  }

  function compactHeader(doc, periodo, geradoEm){
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor.apply(doc, C.accent);
    doc.text('Fluxo', ML, 11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor.apply(doc, C.muted);
    doc.text('Relatório de gastos · ' + periodo, ML + 11, 11);
    doc.setTextColor.apply(doc, C.muted);
    doc.text('Gerado em ' + geradoEm, A4W - MR, 11, { align: 'right' });
    doc.setDrawColor.apply(doc, C.line);
    doc.setLineWidth(0.25);
    doc.line(ML, 14, A4W - MR, 14);
    return 22;
  }

  function finalize(doc, geradoEm){
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setDrawColor.apply(doc, C.line);
      doc.setLineWidth(0.2);
      doc.line(ML, 283, A4W - MR, 283);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor.apply(doc, C.muted);
      doc.text('Fluxo · dados salvos neste aparelho', ML, 288);
      doc.text('Gerado em ' + geradoEm + '   ·   Página ' + i + ' de ' + total, A4W - MR, 288, { align: 'right' });
    }
    doc.setPage(1);
  }

  function ensure(ctx, h){
    if (ctx.y + h <= BOTTOM) return;
    ctx.doc.addPage();
    ctx.y = compactHeader(ctx.doc, ctx.periodo, ctx.geradoEm);
  }

  function section(ctx, title){
    ensure(ctx, 14);
    const doc = ctx.doc;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor.apply(doc, C.accent);
    doc.text(title, ML, ctx.y);
    doc.setDrawColor.apply(doc, C.line);
    doc.setLineWidth(0.3);
    doc.line(ML, ctx.y + 1.8, A4W - MR, ctx.y + 1.8);
    ctx.y += 7;
  }

  function paragraph(ctx, text, color){
    const doc = ctx.doc;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor.apply(doc, color || C.muted);
    const lines = doc.splitTextToSize(String(text), CW);
    ensure(ctx, lines.length * 4.6 + 4);
    doc.text(lines, ML, ctx.y);
    ctx.y += lines.length * 4.6 + 4;
  }

  function summary(ctx, items){
    const doc = ctx.doc;
    ensure(ctx, 28);
    const gap = 4;
    const w = (CW - gap * (items.length - 1)) / items.length;
    items.forEach(function(it, i){
      const x = ML + i * (w + gap);
      doc.setFillColor.apply(doc, C.soft);
      doc.roundedRect(x, ctx.y, w, 19, 2, 2, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor.apply(doc, C.muted);
      doc.text(String(it.label).toUpperCase(), x + 4, ctx.y + 6.2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor.apply(doc, it.color || C.ink);
      doc.text(it.value, x + 4, ctx.y + 13.8);
    });
    ctx.y += 27;
  }

  function tableHead(ctx, cols){
    const doc = ctx.doc;
    ensure(ctx, 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor.apply(doc, C.muted);
    let x = ML;
    cols.forEach(function(c){
      const al = c.align || 'left';
      const tx = al === 'right' ? x + c.w - 2 : (al === 'center' ? x + c.w / 2 : x);
      doc.text(String(c.label).toUpperCase(), tx, ctx.y, { align: al });
      x += c.w;
    });
    doc.setDrawColor.apply(doc, C.line);
    doc.setLineWidth(0.25);
    doc.line(ML, ctx.y + 1.8, A4W - MR, ctx.y + 1.8);
    ctx.y += 5.8;
  }

  function tableRow(ctx, cols, values, opts){
    const o = opts || {};
    const doc = ctx.doc;
    const paginaAntes = doc.getNumberOfPages();
    ensure(ctx, 7);
    if (doc.getNumberOfPages() !== paginaAntes) tableHead(ctx, cols);

    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size || 8.4);
    let x = ML;
    cols.forEach(function(c, i){
      const al = c.align || 'left';
      const raw = values[i] == null ? '' : values[i];
      doc.setTextColor.apply(doc, (o.colors && o.colors[i]) || o.color || C.ink);
      const tx = al === 'right' ? x + c.w - 2 : (al === 'center' ? x + c.w / 2 : x);
      doc.text(fit(doc, raw, c.w - 3), tx, ctx.y, { align: al });
      x += c.w;
    });
    ctx.y += 5.4;
  }

  function tableTotal(ctx, cols, values){
    const doc = ctx.doc;
    const paginaAntes = doc.getNumberOfPages();
    ensure(ctx, 9);

    if (doc.getNumberOfPages() !== paginaAntes) {
      tableHead(ctx, cols);
    } else {
      doc.setDrawColor.apply(doc, C.line);
      doc.setLineWidth(0.25);
      doc.line(ML, ctx.y - 1.6, A4W - MR, ctx.y - 1.6);
    }
    tableRow(ctx, cols, values, { bold: true, size: 8.6 });
  }

  /* ---------- relatório do mês ---------- */

  function buildMonth(mk){
    const geradoEm = stamp();
    const periodo = monthLong(mk);
    const st = statsFor(mk);
    const doc = newDoc();
    const ctx = { doc: doc, y: 0, periodo: periodo, geradoEm: geradoEm };

    ctx.y = header(doc, periodo, geradoEm);

    const goal = Number(state.settings && state.settings.savingsGoal) || 0;
    const saved = Math.max(st.balance, 0);
    const goalPct = goal > 0 ? Math.min(100, Math.round((saved / goal) * 100)) : 0;
    const economy = st.income > 0 ? Math.round((st.balance / st.income) * 1000) / 10 : null;

    summary(ctx, [
      { label: 'Receitas', value: money(st.income), color: C.green },
      { label: 'Despesas', value: money(st.expense), color: C.red },
      { label: 'Saldo do mês', value: money(st.balance), color: st.balance < 0 ? C.red : C.accent },
      { label: 'Economia', value: economy == null ? '-' : economy.toLocaleString('pt-BR') + '%' }
    ]);

    if (goal > 0) {
      const texto = saved >= goal
        ? 'Meta de economia: ' + money(goal) + ' — meta batida (' + money(saved) + ' guardados, ' + goalPct + '%).'
        : 'Meta de economia: ' + money(goal) + ' — ' + money(saved) + ' guardados (' + goalPct + '%), faltam ' + money(goal - saved) + '.';
      paragraph(ctx, texto, saved >= goal ? C.accent : C.muted);
    }

    paragraph(ctx, st.count + (st.count === 1 ? ' lançamento no mês.' : ' lançamentos no mês.'), C.muted);

    if (st.openCount) {
      paragraph(ctx, 'Em aberto: ' + money(st.openExpense) + ' em ' +
        st.openCount + (st.openCount === 1 ? ' despesa ainda não paga.' : ' despesas ainda não pagas.'),
        C.red);
    }

    /* cartão de crédito */
    const card = (typeof primaryCard === 'function') ? primaryCard() : null;
    if (card) {
      const info = cardLimitInfo(card);
      const inv = cardInvoice(mk, card);
      let texto = 'Cartão ' + card.name + ': fatura de ' + monthLong(mk) + ' em ' + money(inv.total);
      if (inv.total > 0) {
        texto += ', vence em ' + dateBr(inv.dueDate) + ' — ' +
          (inv.allPaid ? 'paga' : money(inv.paidTotal) + ' pago, ' + money(inv.total - inv.paidTotal) + ' em aberto');
      }
      if (info.limit > 0) {
        texto += '. Limite comprometido: ' + money(info.used) + ' de ' + money(info.limit) + ' (' + info.pct + '%)';
      }
      paragraph(ctx, texto + '.', info.limit > 0 && info.pct >= 80 ? C.red : C.muted);
    }

    if (!st.count) {
      paragraph(ctx, 'Nenhum lançamento registrado neste mês. Adicione receitas e despesas no app e gere o relatório de novo.', C.muted);
      finalize(doc, geradoEm);
      return finish(doc, 'fluxo-relatorio-' + mk + '.pdf');
    }

    /* gastos por categoria */
    const byCat = expenseByCat(mk);
    const cats = Object.keys(byCat).map(function (id) {
      return { id: id, name: catName(id), amount: byCat[id], budget: Number(state.budgets && state.budgets[id]) || 0 };
    }).sort(function (a, b) { return b.amount - a.amount; });

    if (cats.length) {
      section(ctx, 'Gastos por categoria');
      const cols = [
        { label: 'Categoria', w: 74 },
        { label: 'Gasto', w: 32, align: 'right' },
        { label: '% despesas', w: 24, align: 'right' },
        { label: 'Orçamento', w: 30, align: 'right' },
        { label: 'Situação', w: 22, align: 'center' }
      ];
      tableHead(ctx, cols);
      cats.forEach(function (c) {
        let situacao = '-';
        let cor = C.ink;
        if (c.budget > 0) {
          if (c.amount > c.budget) { situacao = 'Acima'; cor = C.red; }
          else { situacao = 'OK'; cor = C.accent; }
        }
        tableRow(ctx, cols, [c.name, money(c.amount), pct(c.amount, st.expense), c.budget > 0 ? money(c.budget) : '-', situacao], { color: cor });
      });
      const orcamentoTotal = cats.reduce(function (s, c) { return s + c.budget; }, 0);
      tableTotal(ctx, cols, ['Total', money(st.expense), '100%', orcamentoTotal > 0 ? money(orcamentoTotal) : '-', '']);
      ctx.y += 4;
    }

    /* contas fixas */
    const fixes = (state.recurrings || []).filter(function (r) { return r.active && r.type !== 'income'; });
    if (fixes.length) {
      section(ctx, 'Contas fixas do mês');
      const cols = [
        { label: 'Conta', w: 88 },
        { label: 'Dia', w: 18, align: 'center' },
        { label: 'Valor', w: 36, align: 'right' },
        { label: 'Situação', w: 40, align: 'center' }
      ];
      tableHead(ctx, cols);
      fixes.forEach(function (r) {
        const lancada = state.transactions.some(function (t) {
          return t.recurringId === r.id && t.date.slice(0, 7) === mk;
        });
        tableRow(ctx, cols, [r.desc, String(r.day), money(r.amount), lancada ? 'Lançada' : 'A lançar'],
          { color: lancada ? C.ink : C.muted });
      });
      ctx.y += 4;
    }

    /* receitas e despesas */
    const list = sortedTx(txByMonth(mk)).slice().reverse();
    const receitas = list.filter(function (t) { return t.type === 'income'; });
    const despesas = list.filter(function (t) { return t.type !== 'income'; });

    if (receitas.length) {
      section(ctx, 'Receitas');
      const cols = [
        { label: 'Data', w: 22 },
        { label: 'Descrição', w: 86 },
        { label: 'Categoria', w: 42 },
        { label: 'Valor', w: 32, align: 'right' }
      ];
      tableHead(ctx, cols);
      receitas.forEach(function (t) {
        tableRow(ctx, cols, [dateBr(t.date), t.desc, catName(t.category), money(t.amount)]);
      });
      tableTotal(ctx, cols, ['', 'Total de receitas', '', money(st.income)]);
      ctx.y += 4;
    }

    if (despesas.length) {
      section(ctx, 'Despesas');
      const cols = [
        { label: 'Data', w: 20 },
        { label: 'Descrição', w: 58 },
        { label: 'Categoria', w: 36 },
        { label: 'Forma', w: 22 },
        { label: 'Status', w: 16, align: 'center' },
        { label: 'Valor', w: 30, align: 'right' }
      ];
      tableHead(ctx, cols);
      despesas.forEach(function (t) {
        const forma = (t.method || 'Pix') +
          (t.cardId && typeof txCard === 'function' ? ' · ' + (txCard(t) ? txCard(t).name : 'Cartão') : '');
        tableRow(ctx, cols, [dateBr(t.date), t.desc, catName(t.category), forma,
          t.paid ? 'Pago' : 'Aberto', money(t.amount)],
          { colors: [null, null, null, null, t.paid ? C.green : C.red, null] });
      });
      tableTotal(ctx, cols, ['', 'Total de despesas', '', '', '', money(st.expense)]);
      ctx.y += 4;
    }

    finalize(doc, geradoEm);
    return finish(doc, 'fluxo-relatorio-' + mk + '.pdf');
  }

  /* ---------- relatório do ano ---------- */

  function buildYear(year){
    const geradoEm = stamp();
    const periodo = 'Ano ' + year;
    const doc = newDoc();
    const ctx = { doc: doc, y: 0, periodo: periodo, geradoEm: geradoEm };
    ctx.y = header(doc, periodo, geradoEm);

    const hoje = new Date();
    const ultimoMes = (year === hoje.getFullYear()) ? hoje.getMonth() + 1 : 12;

    const meses = [];
    let totalIn = 0;
    let totalOut = 0;
    for (let m = 1; m <= ultimoMes; m++) {
      const mk = year + '-' + String(m).padStart(2, '0');
      const s = statsFor(mk);
      totalIn += s.income;
      totalOut += s.expense;
      meses.push({ mk: mk, s: s });
    }
    const saldo = Math.round((totalIn - totalOut) * 100) / 100;
    const comDados = meses.filter(function (m) { return m.s.count > 0; });
    const media = comDados.length ? totalOut / comDados.length : 0;

    summary(ctx, [
      { label: 'Receitas no ano', value: money(totalIn), color: C.green },
      { label: 'Despesas no ano', value: money(totalOut), color: C.red },
      { label: 'Saldo do ano', value: money(saldo), color: saldo < 0 ? C.red : C.accent },
      { label: 'Média por mês', value: money(media) }
    ]);

    paragraph(ctx, comDados.length + (comDados.length === 1 ? ' mês com lançamentos.' : ' meses com lançamentos.'), C.muted);

    section(ctx, 'Mês a mês');
    const colsM = [
      { label: 'Mês', w: 60 },
      { label: 'Receitas', w: 40, align: 'right' },
      { label: 'Despesas', w: 40, align: 'right' },
      { label: 'Saldo', w: 42, align: 'right' }
    ];
    tableHead(ctx, colsM);
    comDados.forEach(function (m) {
      const nome = MONTHS_LONG[Number(m.mk.slice(5, 7)) - 1];
      const label = nome.charAt(0).toUpperCase() + nome.slice(1);
      tableRow(ctx, colsM, [label, money(m.s.income), money(m.s.expense), money(m.s.balance)]);
    });
    tableTotal(ctx, colsM, ['Total do ano', money(totalIn), money(totalOut), money(saldo)]);
    ctx.y += 5;

    /* categorias do ano */
    const porCat = {};
    meses.forEach(function (m) {
      Object.keys(expenseByCat(m.mk)).forEach(function (id) {
        porCat[id] = (porCat[id] || 0) + expenseByCat(m.mk)[id];
      });
    });
    const cats = Object.keys(porCat).map(function (id) {
      return { name: catName(id), amount: porCat[id] };
    }).sort(function (a, b) { return b.amount - a.amount; });

    if (cats.length) {
      section(ctx, 'Gastos por categoria no ano');
      const cols = [
        { label: 'Categoria', w: 96 },
        { label: 'Total', w: 48, align: 'right' },
        { label: '% das despesas', w: 38, align: 'right' }
      ];
      tableHead(ctx, cols);
      cats.forEach(function (c) {
        tableRow(ctx, cols, [c.name, money(c.amount), pct(c.amount, totalOut)]);
      });
      tableTotal(ctx, cols, ['Total', money(totalOut), '100%']);
      ctx.y += 5;
    }

    /* maiores gastos */
    const maiores = state.transactions
      .filter(function (t) { return t.type !== 'income' && t.date.slice(0, 4) === String(year); })
      .sort(function (a, b) { return b.amount - a.amount; })
      .slice(0, 15);

    if (maiores.length) {
      section(ctx, 'Maiores gastos do ano');
      const cols = [
        { label: 'Data', w: 22 },
        { label: 'Descrição', w: 88 },
        { label: 'Categoria', w: 42 },
        { label: 'Valor', w: 30, align: 'right' }
      ];
      tableHead(ctx, cols);
      maiores.forEach(function (t) {
        tableRow(ctx, cols, [dateBr(t.date), t.desc, catName(t.category), money(t.amount)]);
      });
      ctx.y += 4;
    }

    if (!comDados) {
      paragraph(ctx, 'Nenhum lançamento registrado neste ano.', C.muted);
    }

    finalize(doc, geradoEm);
    return finish(doc, 'fluxo-relatorio-' + year + '.pdf');
  }

  function finish(doc, filename){
    const uri = doc.output('datauristring');
    const base64 = uri.indexOf('base64,') >= 0 ? uri.split('base64,')[1] : '';
    return { base64: base64, filename: filename, mime: 'application/pdf' };
  }

  window.FluxoReport = {
    month: buildMonth,
    year: buildYear
  };

})();
