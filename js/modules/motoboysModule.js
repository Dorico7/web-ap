(function(){
  'use strict';

  window.GMFLEX = window.GMFLEX || {};

  // ─── Estado interno do módulo ─────────────────────────────────────────────
  var _repo = null;
  var _companyId = null;
  var _canManage = false;
  var _toast = null;

  // Usuário autenticado atual — { id, nome } — usado para gravar o "usuário
  // responsável pelo lançamento" em cada Adiantamento criado. Fornecido pelo
  // app.js no init() (6º parâmetro, opcional e retrocompatível).
  var _currentUser = null;

  // Função fornecida pelo app.js: async function(dateFrom, dateTo) -> receita total
  // das transportadoras naquele intervalo. Substituiu o antigo valor fixo do "mês
  // atual" - ver correção do bug de Lucro Líquido incorreto em filtros que não são
  // o mês corrente completo (Hoje/Semana/Ano/Custom).
  var _getReceitaFn = null;

  // Receita das transportadoras já calculada para o período atualmente exibido no
  // Dashboard/Relatórios (_filterPeriod). Recalculada sempre que _loadEntries() roda.
  var _periodReceita = 0;

  // Cache em memória (recarregado ao abrir cada sub-tela)
  var _motoboys = [];
  var _motoristas = [];
  var _rates = [];
  var _entries = [];         // usado por Dashboard / Relatórios (filtro por período)
  var _dayEntries = [];      // lançamentos do dia selecionado na aba Lançamentos
  var _monthEntries = [];    // lançamentos do mês exibido no mini-calendário (para os pontinhos)
  var _adiantamentos = [];         // todos os adiantamentos da empresa (aba Adiantamentos + Fechamento)
  var _periodAdiantamentos = [];   // adiantamentos filtrados pelo período do Dashboard/Relatórios

  // Estado de navegação
  var _subTab = 'lancamentos';   // lancamentos | adiantamentos | fechamento | motoboys | motoristas | dashboard | relatorios
  var _loading = false;
  var _msg = null;
  var _editingMotoboy = null;    // null = novo, objeto = edição
  var _editingMotorista = null;
  var _showInactiveMotoboys = false;
  var _showInactiveMotoristas = false;
  var _showInactiveLanc = false;

  // Estado da aba Adiantamentos (Vales) — modelo genérico: os mesmos
  // formulário/lista/filtros servem tanto para Motoboys quanto para
  // Motoristas, alternando por `_adiTipoPessoa`.
  var _showAddAdiantamento = false;
  var _editingAdiantamento = null;  // null = nenhum form aberto para edição; objeto = editando
  var _adiTipoPessoa = 'MOTOBOY';   // 'MOTOBOY' | 'MOTORISTA' — aba ativa dentro de Adiantamentos
  var _adiFilterPessoa = '';
  var _adiFilterStatus = '';
  var _adiFilterFrom = '';
  var _adiFilterTo = '';

  // Filtros do dashboard / relatórios
  var _filterPeriod = 'mes';     // hoje | semana | mes | ano | custom
  var _filterFrom = '';
  var _filterTo = '';
  var _filterMotoboy = '';
  var _filterMotorista = '';

  // Estado da aba Lançamentos (calendário + cartões por motoboy, igual à Coleta Diária)
  var _lancDate = _todayISO();
  var _lancCalYear = (new Date()).getFullYear();
  var _lancCalMonth = (new Date()).getMonth() + 1;
  var _lancSearch = '';
  var _showAddMotoboy = false;
  var _addMotoboyError = '';
  var _dayMotoristaId = '';      // motorista da diária no dia selecionado (opcional)
  var _dayFieldTimers = {};

  // Estado da aba Fechamento (fechamento mensal para pagamento dos motoboys)
  var _fechYear = (new Date()).getFullYear();
  var _fechMonth = (new Date()).getMonth() + 1;
  var _fechEntries = [];         // lançamentos do mês exibido no Fechamento
  var _expandedFechMotoboy = null; // id do motoboy com o detalhamento diário aberto

  // Marketplaces fixos do sistema — motoboys só entregam por ML ou Shopee
  var MARKETPLACES = ['MERCADO LIVRE', 'SHOPEE'];

  var MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var WEEKDAY_SHORT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  var WEEKDAY_FULL = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

  // Tarifas padrão por motoboy (nome em maiúsculas → { ml, sh })
  var DEFAULT_MOTOBOY_RATES = {
    'SAMUEL':   { ml: 4.50, sh: 3.50 },
    'NATAN':    { ml: 4.50, sh: 4.50 },
    'EDUARDO':  { ml: 4.00, sh: 3.50 },
    'DANILO':   { ml: 4.50, sh: 4.00 },
    'NICASSIO': { ml: 4.00, sh: 3.50 },
    'ALISSON':  { ml: 4.00, sh: 3.50 }
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function _todayISO(){
    var t = new Date();
    return t.getFullYear() + '-' + _pad(t.getMonth()+1) + '-' + _pad(t.getDate());
  }

  function _pad(n){ return n < 10 ? '0'+n : ''+n; }

  function _isoDate(y,m,d){ return y+'-'+_pad(m)+'-'+_pad(d); }
  function _daysInMonth(y,m){ return new Date(y, m, 0).getDate(); }
  function _firstWeekday(y,m){ return new Date(y, m-1, 1).getDay(); }
  function _isSunday(y,m,d){ return new Date(y,m-1,d).getDay() === 0; }

  function _brDate(iso){
    if(!iso) return '';
    var p = iso.split('-');
    return p[2]+'/'+p[1]+'/'+p[0];
  }

  function _money(v){
    v = parseFloat(v) || 0;
    var neg = v < 0;
    var s = 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
    return neg ? '-'+s : s;
  }

  function _escapeHTML(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function _escapeAttr(value){ return _escapeHTML(value).replace(/`/g, '&#96;'); }

  function _iconSearch(){
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  }

  function _periodDates(period, from, to){
    var today = _todayISO();
    var t = new Date();
    if(period === 'hoje') return { from: today, to: today };
    if(period === 'semana'){
      var day = t.getDay();
      var mon = new Date(t); mon.setDate(t.getDate() - day + (day === 0 ? -6 : 1));
      var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      // NÃO usar toISOString() aqui: ele converte para UTC e, no fuso do Brasil
      // (UTC-3), acessar o sistema à noite (a partir de ~21h) fazia a data virar o
      // dia seguinte, deslocando a semana inteira em 1 dia. Usa-se a data LOCAL,
      // igual ao padrão já usado no resto do arquivo (_isoDate).
      return {
        from: _isoDate(mon.getFullYear(), mon.getMonth()+1, mon.getDate()),
        to: _isoDate(sun.getFullYear(), sun.getMonth()+1, sun.getDate())
      };
    }
    if(period === 'mes'){
      return { from: t.getFullYear()+'-'+_pad(t.getMonth()+1)+'-01', to: today };
    }
    if(period === 'ano'){
      return { from: t.getFullYear()+'-01-01', to: today };
    }
    if(period === 'custom') return { from: from || today, to: to || today };
    return { from: today, to: today };
  }

  // ─── Helpers genéricos de "pessoa" (Motoboy OU Motorista) ─────────────────
  // Usados pela aba Adiantamentos (Vales) e pelo Fechamento de Motoristas, que
  // reaproveitam a mesma lógica de desconto por quinzena já usada para
  // Motoboys, sem duplicar código: em vez de um embed de FK (impossível aqui,
  // já que `pessoa_id` aponta para tabelas diferentes conforme `tipo_pessoa`),
  // o nome é resolvido a partir das listas já carregadas em memória.

  function _pessoaLista(tipoPessoa){
    return tipoPessoa === 'MOTORISTA' ? _motoristas : _motoboys;
  }

  function _pessoaNome(tipoPessoa, pessoaId){
    var lista = _pessoaLista(tipoPessoa);
    var p = lista.find(function(x){ return x.id === pessoaId; });
    return p ? p.nome : '—';
  }

  function _pessoaLabel(tipoPessoa){
    return tipoPessoa === 'MOTORISTA' ? 'Motorista' : 'Motoboy';
  }

  // Busca a tarifa (ML ou SH) de um motoboy já carregada em memória
  function _getRate(motoboyId, transp){
    var r = _rates.find(function(x){ return x.motoboy_id === motoboyId && x.transportadora === transp; });
    return r ? (parseFloat(r.valor_pacote) || 0) : 0;
  }

  // Retorna as quantidades/valores lançados de um motoboy no dia selecionado (_lancDate)
  // Quantidade null = ainda não lançado (campo aparece vazio, igual à Coleta Diária)
  function _getMotoboyDayData(motoboyId){
    var ml = _dayEntries.find(function(e){ return e.motoboy_id === motoboyId && e.transportadora === 'MERCADO LIVRE'; });
    var sh = _dayEntries.find(function(e){ return e.motoboy_id === motoboyId && e.transportadora === 'SHOPEE'; });
    return {
      mlQtd: ml ? (parseInt(ml.quantidade_pacotes, 10) || 0) : null,
      shQtd: sh ? (parseInt(sh.quantidade_pacotes, 10) || 0) : null,
      mlVal: ml ? (parseFloat(ml.valor_motoboy) || 0) : 0,
      shVal: sh ? (parseFloat(sh.valor_motoboy) || 0) : 0
    };
  }

  // ─── Inicialização ────────────────────────────────────────────────────────

  async function init(companyId, repo, canManage, toastFn, getReceitaFn, currentUserInfo){
    _companyId = companyId;
    _repo = repo;
    _canManage = !!canManage;
    _toast = toastFn || function(){};
    _getReceitaFn = typeof getReceitaFn === 'function' ? getReceitaFn : null;
    _currentUser = currentUserInfo || null;
    _lancDate = _todayISO();
    var today = new Date();
    _lancCalYear = today.getFullYear();
    _lancCalMonth = today.getMonth() + 1;
    await _loadAll();
    // Garante tarifas ML/SH para os motoboys padrão cadastrados
    await _ensureDefaultRates();
    await _loadDayEntries();
    await _loadMonthEntries();
  }

  // Busca no app.js a receita das transportadoras para o intervalo informado.
  // Usada sempre que o período do Dashboard/Relatórios muda, para manter o Lucro
  // Líquido consistente com o período que está sendo exibido.
  async function _refreshPeriodReceita(dateFrom, dateTo){
    if(!_getReceitaFn){ _periodReceita = 0; return; }
    try{
      _periodReceita = await _getReceitaFn(dateFrom, dateTo);
    }catch(error){
      _periodReceita = 0;
    }
  }

  async function _loadAll(){
    _loading = true;
    var results = await Promise.all([
      _repo.getMotoboys(_companyId, true),
      _repo.getMotoristas(_companyId, true),
      _repo.getMotoboiRates(_companyId),
      _repo.getAdiantamentos(_companyId, {})
    ]);
    _loading = false;
    if(!results[0].error) _motoboys = results[0].data || [];
    if(!results[1].error) _motoristas = results[1].data || [];
    if(!results[2].error) _rates = results[2].data || [];
    if(!results[3].error) _adiantamentos = results[3].data || [];
  }

  // Recarrega apenas os adiantamentos (usado após criar/editar/excluir um vale
  // ou marcar adiantamentos como descontados, sem precisar recarregar motoboys/
  // motoristas/tarifas também).
  async function _loadAdiantamentos(){
    var result = await _repo.getAdiantamentos(_companyId, {});
    if(!result.error) _adiantamentos = result.data || [];
    return result;
  }

  async function _loadEntries(){
    var pd = _periodDates(_filterPeriod, _filterFrom, _filterTo);
    var filters = { dateFrom: pd.from, dateTo: pd.to };
    if(_filterMotoboy) filters.motoboyId = _filterMotoboy;
    if(_filterMotorista) filters.motoristaId = _filterMotorista;
    var adiFilters = { dateFrom: pd.from, dateTo: pd.to };
    if(_filterMotoboy) adiFilters.motoboyId = _filterMotoboy;
    // A Receita Total das Transportadoras é sempre a do intervalo de datas do
    // filtro (pd.from/pd.to) - company-wide, independente de filtro por motoboy/
    // motorista, pois essa é a receita real que entrou na empresa nesse período.
    var results = await Promise.all([
      _repo.getEntries(_companyId, filters),
      _refreshPeriodReceita(pd.from, pd.to),
      _repo.getAdiantamentos(_companyId, adiFilters)
    ]);
    var result = results[0];
    if(!result.error) _entries = result.data || [];
    var adiResult = results[2];
    if(!adiResult.error) _periodAdiantamentos = adiResult.data || [];
    return result;
  }

  // Carrega apenas os lançamentos do dia selecionado na aba Lançamentos
  async function _loadDayEntries(){
    var result = await _repo.getEntries(_companyId, { dateFrom: _lancDate, dateTo: _lancDate });
    if(!result.error){
      _dayEntries = result.data || [];
      _dayMotoristaId = '';
      for(var i = 0; i < _dayEntries.length; i++){
        if(_dayEntries[i].motorista_id){ _dayMotoristaId = _dayEntries[i].motorista_id; break; }
      }
    }
    return result;
  }

  // Carrega os lançamentos do mês exibido, apenas para marcar os dias com movimento no calendário
  async function _loadMonthEntries(){
    var from = _isoDate(_lancCalYear, _lancCalMonth, 1);
    var to = _isoDate(_lancCalYear, _lancCalMonth, _daysInMonth(_lancCalYear, _lancCalMonth));
    var result = await _repo.getEntries(_companyId, { dateFrom: from, dateTo: to });
    if(!result.error) _monthEntries = result.data || [];
    return result;
  }

  // Carrega os lançamentos do mês exibido na aba Fechamento (para o fechamento de pagamento).
  // Os adiantamentos NÃO são filtrados pelo mês do fechamento: um vale pendente
  // criado em qualquer data continua valendo até ser descontado, então o cálculo
  // do pagamento líquido usa sempre _adiantamentos (cache completo, recarregado
  // à parte por _loadAdiantamentos()).
  async function _loadFechEntries(){
    var from = _isoDate(_fechYear, _fechMonth, 1);
    var to = _isoDate(_fechYear, _fechMonth, _daysInMonth(_fechYear, _fechMonth));
    var result = await _repo.getEntries(_companyId, { dateFrom: from, dateTo: to });
    if(!result.error) _fechEntries = result.data || [];
    return result;
  }

  // Garante que cada motoboy padrão tenha tarifas ML e Shopee cadastradas
  async function _ensureDefaultRates(){
    if(!_canManage) return;
    for(var i = 0; i < _motoboys.length; i++){
      var mb = _motoboys[i];
      var nomeUpper = (mb.nome || '').toUpperCase();
      var defaultRates = DEFAULT_MOTOBOY_RATES[nomeUpper];
      if(!defaultRates) continue;
      var mbRates = _rates.filter(function(r){ return r.motoboy_id === mb.id; });
      var hasML = mbRates.some(function(r){ return r.transportadora === 'MERCADO LIVRE'; });
      var hasSH = mbRates.some(function(r){ return r.transportadora === 'SHOPEE'; });
      if(!hasML){
        var resML = await _repo.upsertMotoboiRate({ company_id: _companyId, motoboy_id: mb.id, transportadora: 'MERCADO LIVRE', valor_pacote: defaultRates.ml });
        if(!resML.error && resML.data) _rates.push(resML.data);
      }
      if(!hasSH){
        var resSH = await _repo.upsertMotoboiRate({ company_id: _companyId, motoboy_id: mb.id, transportadora: 'SHOPEE', valor_pacote: defaultRates.sh });
        if(!resSH.error && resSH.data) _rates.push(resSH.data);
      }
    }
  }

  // ─── Cálculo do Lucro Líquido Oficial ─────────────────────────────────────
  // Regra: Lucro Líquido = Receita Total Transportadoras − Total Motoboys − Total Motoristas

  function _calcLucroLiquido(totalMotoboys, totalDiarias){
    return Math.round((_periodReceita - totalMotoboys - totalDiarias) * 100) / 100;
  }

  // Agrega totais dos lançamentos usando a regra oficial.
  // IMPORTANTE: usa _periodReceita, que é recalculada por _refreshPeriodReceita()
  // toda vez que o filtro de período muda (ver _loadEntries), garantindo que a
  // Receita Total das Transportadoras corresponda exatamente ao mesmo intervalo
  // de datas dos lançamentos passados em `entries`.
  function _calcTotaisEntries(entries){
    var totalMotoboys = 0, totalPacotes = 0;
    entries.forEach(function(e){
      totalMotoboys += parseFloat(e.valor_motoboy) || 0;
      totalPacotes += parseInt(e.quantidade_pacotes, 10) || 0;
    });
    var totalDiarias = _repo.calcTotalDiarias(entries);
    totalMotoboys = Math.round(totalMotoboys * 100) / 100;
    var lucroLiquido = _calcLucroLiquido(totalMotoboys, totalDiarias);
    return {
      receitaTransportadoras: _periodReceita,
      totalMotoboys: totalMotoboys,
      totalDiarias: totalDiarias,
      lucroLiquido: lucroLiquido,
      totalPacotes: totalPacotes,
      totalEntregas: entries.length
    };
  }

  // ─── Render principal ─────────────────────────────────────────────────────

  function render(){
    if(_loading) return '<div class="mb-loading">Carregando módulo Motoboys...</div>';
    var h = '<div class="mb-module">';
    h += _renderSubTabs();
    if(_msg){ h += '<div class="mb-msg '+((_msg.type||'ok')==='ok'?'mb-msg-ok':'mb-msg-err')+'">'+_escapeHTML(_msg.text)+'</div>'; _msg = null; }
    if(_subTab === 'lancamentos') h += _renderLancamentos();
    else if(_subTab === 'adiantamentos') h += _renderAdiantamentos();
    else if(_subTab === 'fechamento') h += _renderFechamento();
    else if(_subTab === 'motoboys') h += _renderMotoboys();
    else if(_subTab === 'motoristas') h += _renderMotoristas();
    else if(_subTab === 'dashboard') h += _renderDashboard();
    else if(_subTab === 'relatorios') h += _renderRelatorios();
    h += '</div>';
    if(_subTab === 'lancamentos') h += _renderLancFooter();
    return h;
  }

  function _renderSubTabs(){
    var tabs = [
      ['lancamentos','Lançamentos'],
      ['adiantamentos','Adiantamentos'],
      ['fechamento','Fechamento'],
      ['dashboard','Dashboard'],
      ['relatorios','Relatórios'],
      ['motoboys','Motoboys'],
      ['motoristas','Motoristas']
    ];
    var h = '<div class="mb-subtabs">';
    tabs.forEach(function(t){
      h += '<button class="mb-stab'+(_subTab===t[0]?' active':'')+'" data-mb-tab="'+t[0]+'">'+t[1]+'</button>';
    });
    h += '</div>';
    return h;
  }

  // ─── Lançamentos (calendário + cartões por motoboy, igual à Coleta Diária) ─

  function _renderLancamentos(){
    var h = '<div class="mb-section">';
    h += _renderLancCalendar();
    h += _renderLancDayPanel();
    h += '</div>';
    return h;
  }

  function _renderLancCalendar(){
    var y = _lancCalYear, m = _lancCalMonth, n = _daysInMonth(y,m), start = _firstWeekday(y,m), tISO = _todayISO();
    var h = '<div class="mb-cal-nav">';
    h += '<button class="mb-cal-nav-btn" data-mb-cal-nav="-1">‹</button>';
    h += '<div class="mb-cal-nav-title">'+MONTH_NAMES[m-1]+' '+y+'</div>';
    h += '<button class="mb-cal-nav-btn" data-mb-cal-nav="1">›</button>';
    h += '</div>';
    h += '<div class="cal-wrap"><div class="cal-weekdays">';
    WEEKDAY_SHORT.forEach(function(w){ h += '<span>'+w+'</span>'; });
    h += '</div><div class="cal-grid">';
    for(var i=0;i<start;i++) h += '<div class="cal-cell blank"></div>';
    for(var d=1; d<=n; d++){
      var key = _isoDate(y,m,d), sun = _isSunday(y,m,d), sel = key === _lancDate, isToday = key === tISO;
      var hasData = _monthEntries.some(function(e){ return e.date_key === key && (parseInt(e.quantidade_pacotes,10)||0) > 0; });
      var cls = 'cal-cell'+(sun?' sunday':'')+(sel?' selected':'')+(isToday?' today':'');
      h += '<div class="'+cls+'" data-mb-lanc-date="'+key+'"><span class="cnum">'+d+'</span>'+(hasData?'<span class="cdot"></span>':'')+'</div>';
    }
    h += '</div></div>';
    return h;
  }

  function _renderLancDayPanel(){
    var key = _lancDate;
    var parts = key.split('-');
    var dObj = new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));
    var wd = WEEKDAY_FULL[dObj.getDay()];
    var sun = dObj.getDay() === 0;
    var label = wd+', '+parseInt(parts[2],10)+' de '+MONTH_NAMES[parseInt(parts[1],10)-1].toLowerCase();

    var h = '<div class="day-panel"><div class="day-title">'+label+'</div>';
    if(sun) h += '<div class="off-banner">☀️ Domingo — normalmente sem operação, mas você pode lançar se precisar.</div>';

    if(_motoristas.length > 0) h += _renderDayMotoristaSelector();

    h += '<div class="searchbar-row">';
    h += '  <div class="searchbar">'+_iconSearch()+'<input id="mb-lanc-search" placeholder="Buscar motoboy..." value="'+_escapeAttr(_lancSearch)+'"/></div>';
    if(_canManage) h += '  <button class="add-partner-btn" id="mb-toggle-add-motoboy">'+(_showAddMotoboy?'✕':'+')+'</button>';
    h += '</div>';

    if(_showAddMotoboy && _canManage){
      h += '<div class="add-partner-card">';
      h += '  <h4>Novo motoboy</h4>';
      h += '  <input id="mb-new-nome" class="add-input" type="text" placeholder="Nome do motoboy" autocomplete="off"/>';
      h += '  <div class="add-rate-row">';
      h += '    <input id="mb-new-ml" class="add-input" type="text" inputmode="decimal" placeholder="Tarifa ML (ex: 4,50)"/>';
      h += '    <input id="mb-new-sh" class="add-input" type="text" inputmode="decimal" placeholder="Tarifa SH (ex: 3,50)"/>';
      h += '  </div>';
      if(_addMotoboyError) h += '  <div class="add-error">'+_escapeHTML(_addMotoboyError)+'</div>';
      h += '  <button class="add-confirm-btn" id="mb-confirm-add-motoboy">Adicionar motoboy</button>';
      h += '</div>';
    }

    var searchLower = _lancSearch.toLowerCase();
    var activeList = _motoboys.filter(function(m){ return m.status === 'Ativo' && m.nome.toLowerCase().indexOf(searchLower) !== -1; });

    if(activeList.length === 0){
      h += '<div class="empty-state">Nenhum motoboy encontrado.</div>';
    } else {
      h += '<div class="driver-list">';
      activeList.forEach(function(m){ h += _renderLancMotoboyRow(m, false); });
      h += '</div>';
    }

    if(_canManage){
      var inactiveList = _motoboys.filter(function(m){ return m.status === 'Inativo'; });
      if(inactiveList.length){
        h += '<div class="inactive-toggle-row"><button class="inactive-toggle-btn" id="mb-toggle-inactive-lanc">'+(_showInactiveLanc?'▾':'▸')+' Motoboys inativos ('+inactiveList.length+')</button></div>';
        if(_showInactiveLanc){
          h += '<div class="driver-list inactive-list">';
          inactiveList.forEach(function(m){ h += _renderLancMotoboyRow(m, true); });
          h += '</div>';
        }
      }
    }
    h += '</div>';
    return h;
  }

  function _renderDayMotoristaSelector(){
    var activeMotoristas = _motoristas.filter(function(m){ return m.status === 'Ativo'; });
    var h = '<div class="mb-day-motorista">';
    h += '<label>Motorista da diária (opcional)</label>';
    h += '<select id="mb-day-motorista" class="mb-input"'+(_canManage?'':' disabled')+'>';
    h += '<option value="">Nenhum</option>';
    activeMotoristas.forEach(function(m){
      h += '<option value="'+_escapeAttr(m.id)+'"'+(m.id===_dayMotoristaId?' selected':'')+'>'+_escapeHTML(m.nome)+' — diária '+_money(m.valor_diaria)+'</option>';
    });
    h += '</select>';
    h += '</div>';
    return h;
  }

  // Cartão de lançamento do motoboy — igual ao card de transportadora da Coleta Diária,
  // mas com dois campos (ML e Shopee) em vez de um só
  function _renderLancMotoboyRow(m, isInactive){
    var mlRate = _getRate(m.id, 'MERCADO LIVRE');
    var shRate = _getRate(m.id, 'SHOPEE');
    var cls = 'driver-row'+(isInactive?' driver-row-inactive':'');
    var h = '<div class="'+cls+'" data-mb-lanc-row="'+_escapeAttr(m.id)+'">';
    h += '  <div><div class="driver-name">'+_escapeHTML(m.nome)+'</div><div class="driver-rate">ML R$'+mlRate.toFixed(2).replace('.',',')+' · SH R$'+shRate.toFixed(2).replace('.',',')+'</div></div>';

    if(isInactive){
      h += '  <button class="driver-reactivate-btn" data-mb-reactivate-motoboy="'+_escapeAttr(m.id)+'">Reativar</button>';
      h += '</div>';
      return h;
    }

    var d = _getMotoboyDayData(m.id);
    var total = Math.round(((d.mlVal||0) + (d.shVal||0)) * 100) / 100;
    var canTypeML = _canManage && mlRate > 0;
    var canTypeSH = _canManage && shRate > 0;

    h += '  <div class="field"><label>ML</label><input type="number" min="0" step="1" inputmode="numeric" class="mb-launch-input"';
    h += '    data-mb-lanc-qtd="'+_escapeAttr(m.id)+'" data-mb-lanc-mk="MERCADO LIVRE"';
    h += '    value="'+(d.mlQtd!==null && d.mlQtd!==undefined ? d.mlQtd : '')+'" placeholder="0"'+(canTypeML?'':' disabled')+'/></div>';

    h += '  <div class="field"><label>SH</label><input type="number" min="0" step="1" inputmode="numeric" class="mb-launch-input"';
    h += '    data-mb-lanc-qtd="'+_escapeAttr(m.id)+'" data-mb-lanc-mk="SHOPEE"';
    h += '    value="'+(d.shQtd!==null && d.shQtd!==undefined ? d.shQtd : '')+'" placeholder="0"'+(canTypeSH?'':' disabled')+'/></div>';

    if(_canManage) h += '  <button class="driver-remove-btn" data-mb-remove-motoboy="'+_escapeAttr(m.id)+'" title="Encerrar / desativar motoboy">✕</button>';

    h += '  <div class="row-value">valor do dia: <b>'+_money(total)+'</b></div>';
    h += '</div>';
    return h;
  }

  function _renderLancFooter(){
    var pctML = 0, pctSH = 0, totalPago = 0;
    _dayEntries.forEach(function(e){
      var qtd = parseInt(e.quantidade_pacotes, 10) || 0;
      if(e.transportadora === 'MERCADO LIVRE') pctML += qtd;
      else if(e.transportadora === 'SHOPEE') pctSH += qtd;
      totalPago += parseFloat(e.valor_motoboy) || 0;
    });
    totalPago = Math.round(totalPago * 100) / 100;
    var h = '<div class="footer-bar" style="flex-wrap:wrap;gap:8px;">';
    h += '  <div class="footer-metric"><div class="flabel">Pacotes ML</div><div class="fval" id="mb-foot-ml">'+pctML+'</div></div>';
    h += '  <div class="footer-metric"><div class="flabel">Pacotes SH</div><div class="fval" id="mb-foot-sh">'+pctSH+'</div></div>';
    h += '  <div class="footer-metric"><div class="flabel">Total Pacotes</div><div class="fval" id="mb-foot-totalpct">'+(pctML+pctSH)+'</div></div>';
    h += '  <div class="footer-metric money"><div class="flabel">Total Motoboys</div><div class="fval" id="mb-foot-total">'+_money(totalPago)+'</div></div>';
    h += '  <div class="save-chip"><span class="save-dot"></span><span id="mb-save-chip-text">salvo</span></div>';
    h += '</div>';
    return h;
  }

  function _refreshLancFooterDOM(container){
    var pctML = 0, pctSH = 0, totalPago = 0;
    _dayEntries.forEach(function(e){
      var qtd = parseInt(e.quantidade_pacotes, 10) || 0;
      if(e.transportadora === 'MERCADO LIVRE') pctML += qtd;
      else if(e.transportadora === 'SHOPEE') pctSH += qtd;
      totalPago += parseFloat(e.valor_motoboy) || 0;
    });
    totalPago = Math.round(totalPago * 100) / 100;
    var elML = document.getElementById('mb-foot-ml');
    var elSH = document.getElementById('mb-foot-sh');
    var elTotalPct = document.getElementById('mb-foot-totalpct');
    var elTotal = document.getElementById('mb-foot-total');
    if(elML) elML.textContent = pctML;
    if(elSH) elSH.textContent = pctSH;
    if(elTotalPct) elTotalPct.textContent = pctML + pctSH;
    if(elTotal) elTotal.textContent = _money(totalPago);
  }

  function _setSaveChip(text){
    var el = document.getElementById('mb-save-chip-text');
    if(el) el.textContent = text;
  }

  // ─── Adiantamentos (Vales) ────────────────────────────────────────────────
  // Cadastro e histórico de adiantamentos por motoboy: vale, combustível,
  // empréstimo ou qualquer outro desconto lançado antecipadamente. Cada um fica
  // "Pendente" até ser explicitamente descontado no Fechamento (aba Fechamento),
  // quando passa a "Descontado" e nunca mais é somado novamente.

  // Retrocompatível: `a.pessoa_id`/`a.tipo_pessoa` são os campos genéricos; um
  // registro antigo que só tenha `a.motoboy_id` (ainda não recarregado do
  // banco genérico) é tratado como MOTOBOY.
  function _adiPessoaId(a){ return a.pessoa_id || a.motoboy_id; }
  function _adiTipo(a){ return a.tipo_pessoa || (a.motoboy_id ? 'MOTOBOY' : 'MOTOBOY'); }

  function _filteredAdiantamentos(){
    return _adiantamentos.filter(function(a){
      if(_adiTipo(a) !== _adiTipoPessoa) return false;
      if(_adiFilterPessoa && _adiPessoaId(a) !== _adiFilterPessoa) return false;
      if(_adiFilterStatus && a.status !== _adiFilterStatus) return false;
      if(_adiFilterFrom && a.data_key < _adiFilterFrom) return false;
      if(_adiFilterTo && a.data_key > _adiFilterTo) return false;
      return true;
    });
  }

  function _renderAdiantamentos(){
    var list = _filteredAdiantamentos();
    var totais = _repo.calcAdiantamentosTotais(list);
    var pessoaLista = _pessoaLista(_adiTipoPessoa);
    var pessoaLabel = _pessoaLabel(_adiTipoPessoa);

    var h = '<div class="mb-section">';
    h += '<div class="mb-section-header"><h3>Adiantamentos (Vales)</h3>';
    if(_canManage) h += '<button class="mb-btn-primary" id="mb-novo-adiantamento">+ Novo Adiantamento</button>';
    h += '</div>';

    h += '<div class="mb-subtabs mb-adi-tipo-tabs">';
    h += '<button class="mb-stab'+(_adiTipoPessoa==='MOTOBOY'?' active':'')+'" data-mb-adi-tipo="MOTOBOY">Motoboys</button>';
    h += '<button class="mb-stab'+(_adiTipoPessoa==='MOTORISTA'?' active':'')+'" data-mb-adi-tipo="MOTORISTA">Motoristas</button>';
    h += '</div>';

    if(_canManage && (_showAddAdiantamento || _editingAdiantamento !== null)){
      h += _renderAdiantamentoForm();
    }

    h += '<div class="mb-extra-filters">';
    h += '<select class="mb-input mb-filter-sel" id="mb-adi-filter-pessoa"><option value="">Todos os '+_escapeHTML(pessoaLabel.toLowerCase())+'s</option>';
    pessoaLista.forEach(function(m){ h += '<option value="'+_escapeAttr(m.id)+'"'+(m.id===_adiFilterPessoa?' selected':'')+'>'+_escapeHTML(m.nome)+'</option>'; });
    h += '</select>';
    h += '<select class="mb-input mb-filter-sel" id="mb-adi-filter-status">';
    h += '<option value=""'+(_adiFilterStatus===''?' selected':'')+'>Todos os status</option>';
    h += '<option value="Pendente"'+(_adiFilterStatus==='Pendente'?' selected':'')+'>Pendente</option>';
    h += '<option value="Descontado"'+(_adiFilterStatus==='Descontado'?' selected':'')+'>Descontado</option>';
    h += '</select>';
    h += '</div>';
    h += '<div class="mb-date-range">';
    h += '<input type="date" class="mb-input-date" id="mb-adi-filter-from" value="'+_escapeAttr(_adiFilterFrom)+'"/>';
    h += '<span class="mb-range-sep">até</span>';
    h += '<input type="date" class="mb-input-date" id="mb-adi-filter-to" value="'+_escapeAttr(_adiFilterTo)+'"/>';
    h += '<button class="mb-btn-sm" id="mb-adi-apply-filters">Filtrar</button>';
    if(_adiFilterPessoa || _adiFilterStatus || _adiFilterFrom || _adiFilterTo){
      h += '<button class="mb-btn-sm" id="mb-adi-clear-filters">Limpar</button>';
    }
    h += '</div>';

    h += '<div class="mb-kpi-grid">';
    h += _kpi('Total Pendente', _money(totais.totalPendente), 'neg');
    h += _kpi('Total Descontado', _money(totais.totalDescontado), 'pos');
    h += _kpi('Total Geral', _money(totais.totalGeral), '');
    h += '</div>';

    if(list.length === 0){
      h += '<div class="mb-empty">Nenhum adiantamento de '+_escapeHTML(pessoaLabel.toLowerCase())+' encontrado para os filtros selecionados.</div>';
    } else {
      h += '<div class="mb-entry-list">';
      list.forEach(function(a){ h += _renderAdiantamentoRow(a); });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderAdiantamentoRow(a){
    var tipo = _adiTipo(a);
    var nome = _pessoaNome(tipo, _adiPessoaId(a));
    var isPend = a.status !== 'Descontado';
    var h = '<div class="mb-entry-row">';
    h += '<div class="mb-entry-top">';
    h += '  <span class="mb-entry-date">'+_brDate(a.data_key)+'</span>';
    h += '  <span class="mb-adi-status '+(isPend?'pendente':'descontado')+'">'+_escapeHTML(a.status)+'</span>';
    h += '</div>';
    h += '<div class="mb-entry-body">';
    h += '  <span class="mb-entry-info"><b>'+_escapeHTML(_pessoaLabel(tipo))+':</b> '+_escapeHTML(nome)+'</span>';
    h += '  <span class="mb-entry-info"><b>Motivo:</b> '+_escapeHTML(a.motivo)+'</span>';
    h += '  <span class="mb-entry-info"><b>Valor:</b> '+_money(a.valor)+'</span>';
    if(a.observacao) h += '  <span class="mb-entry-info"><b>Obs.:</b> '+_escapeHTML(a.observacao)+'</span>';
    h += '  <span class="mb-entry-info"><b>Lançado por:</b> '+_escapeHTML(a.usuario_nome || '—')+'</span>';
    if(!isPend && a.descontado_em){
      h += '  <span class="mb-entry-info"><b>Descontado em:</b> '+_escapeHTML(_brDate(String(a.descontado_em).slice(0,10)))+'</span>';
      if(a.fechamento_mes && a.fechamento_ano){
        var qLabel = a.fechamento_quinzena === 1 ? ' (1ª Quinzena)' : (a.fechamento_quinzena === 2 ? ' (2ª Quinzena)' : '');
        h += '  <span class="mb-entry-info"><b>Fechamento:</b> '+_escapeHTML(MONTH_NAMES[a.fechamento_mes-1]+'/'+a.fechamento_ano+qLabel)+'</span>';
      }
    }
    h += '</div>';
    if(_canManage){
      h += '<div class="mb-entry-actions">';
      if(isPend){
        h += '<button class="mb-btn-sm" data-mb-edit-adiantamento="'+_escapeAttr(a.id)+'">Editar</button>';
      }
      h += '<button class="mb-btn-sm danger" data-mb-delete-adiantamento="'+_escapeAttr(a.id)+'">Excluir</button>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderAdiantamentoForm(){
    var isEdit = !!(_editingAdiantamento && _editingAdiantamento.id);
    var d = _editingAdiantamento || {};
    // No cadastro, a pessoa é sempre do tipo selecionado na aba (_adiTipoPessoa);
    // na edição, preserva o tipo original do registro (não é possível "trocar"
    // um adiantamento de motoboy para motorista, só corrigir seus dados).
    var tipo = isEdit ? _adiTipo(d) : _adiTipoPessoa;
    var pessoaLista = _pessoaLista(tipo);
    var pessoaLabel = _pessoaLabel(tipo);
    var pessoaIdAtual = isEdit ? _adiPessoaId(d) : '';
    var h = '<div class="mb-form-card">';
    h += '<h4>'+(isEdit ? 'Editar Adiantamento' : 'Novo Adiantamento de '+_escapeHTML(pessoaLabel)) + '</h4>';
    h += '<div class="mb-form-grid">';
    h += '<input type="hidden" id="mb-adi-tipo-pessoa" value="'+_escapeAttr(tipo)+'"/>';
    h += '<div class="mb-form-field mb-full-width"><label>'+_escapeHTML(pessoaLabel)+' *</label><select id="mb-adi-pessoa" class="mb-input">';
    h += '<option value="">Selecione...</option>';
    pessoaLista.forEach(function(m){ h += '<option value="'+_escapeAttr(m.id)+'"'+(pessoaIdAtual===m.id?' selected':'')+'>'+_escapeHTML(m.nome)+'</option>'; });
    h += '</select></div>';
    h += '<div class="mb-form-field"><label>Valor (R$) *</label><input type="number" id="mb-adi-valor" class="mb-input" min="0.01" step="0.01" inputmode="decimal" value="'+_escapeAttr(d.valor != null ? String(d.valor) : '')+'" placeholder="0,00"/></div>';
    h += '<div class="mb-form-field"><label>Data *</label><input type="date" id="mb-adi-data" class="mb-input" value="'+_escapeAttr(d.data_key || _todayISO())+'"/></div>';
    h += '<div class="mb-form-field mb-full-width"><label>Motivo *</label><input type="text" id="mb-adi-motivo" class="mb-input" list="mb-adi-motivo-list" value="'+_escapeAttr(d.motivo || '')+'" placeholder="Ex: Vale, Combustível, Empréstimo..."/>';
    h += '<datalist id="mb-adi-motivo-list"><option value="Vale"></option><option value="Combustível"></option><option value="Empréstimo"></option><option value="Outro Desconto"></option></datalist></div>';
    h += '<div class="mb-form-field mb-full-width"><label>Observação (opcional)</label><textarea id="mb-adi-obs" class="mb-input mb-textarea" placeholder="Detalhes adicionais...">'+_escapeHTML(d.observacao || '')+'</textarea></div>';
    h += '</div>';
    h += '<div class="mb-form-actions">';
    h += '<button class="mb-btn-primary" id="mb-save-adiantamento">'+(isEdit ? 'Salvar' : 'Cadastrar')+'</button>';
    h += '<button class="mb-btn-ghost" id="mb-cancel-adiantamento">Cancelar</button>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  async function _handleSaveAdiantamento(container){
    var tipoPessoa = (container.querySelector('#mb-adi-tipo-pessoa') || {}).value || _adiTipoPessoa;
    var pessoaId = (container.querySelector('#mb-adi-pessoa') || {}).value || '';
    var valorRaw = (container.querySelector('#mb-adi-valor') || {}).value || '';
    var dataKey = (container.querySelector('#mb-adi-data') || {}).value || '';
    var motivo = ((container.querySelector('#mb-adi-motivo') || {}).value || '').trim();
    var obs = (container.querySelector('#mb-adi-obs') || {}).value || '';

    if(!pessoaId){ _toast('Selecione '+(tipoPessoa==='MOTORISTA'?'o motorista':'o motoboy')+'.'); return; }
    var valor = parseFloat(String(valorRaw).replace(',', '.'));
    if(isNaN(valor) || valor <= 0){ _toast('Informe um valor válido maior que zero.'); return; }
    if(!dataKey){ _toast('Informe a data do adiantamento.'); return; }
    if(!motivo){ _toast('Informe o motivo do adiantamento.'); return; }

    var isEdit = !!(_editingAdiantamento && _editingAdiantamento.id);
    var payload = {
      company_id: _companyId,
      tipo_pessoa: tipoPessoa,
      pessoa_id: pessoaId,
      valor: valor,
      data_key: dataKey,
      motivo: motivo,
      observacao: obs
    };
    if(isEdit){
      // Preserva o usuário que originalmente lançou o adiantamento e o status
      // (edição só é permitida enquanto Pendente — ver _renderAdiantamentoRow).
      payload.id = _editingAdiantamento.id;
      payload.status = _editingAdiantamento.status;
      payload.usuario_id = _editingAdiantamento.usuario_id;
      payload.usuario_nome = _editingAdiantamento.usuario_nome;
    } else {
      payload.usuario_id = _currentUser ? _currentUser.id : null;
      payload.usuario_nome = _currentUser ? (_currentUser.nome || '') : '';
    }

    var result = await _repo.upsertAdiantamento(payload);
    if(result.error){ _toast(result.error.userMessage || 'Erro ao salvar adiantamento.'); return; }
    _toast(isEdit ? 'Adiantamento atualizado.' : 'Adiantamento cadastrado.');
    _showAddAdiantamento = false;
    _editingAdiantamento = null;
    await _loadAdiantamentos();
    _rerender(container);
  }

  // Exclui um adiantamento — permitido tanto para "Pendente" quanto para
  // "Descontado" (correção de lançamentos, mesmo depois de já processados no
  // fechamento). Como excluir um "Descontado" mexe com um pagamento que já foi
  // fechado (e possivelmente já entregue em PDF ao motoboy), o aviso é mais
  // explícito nesse caso, para o gestor confirmar de forma consciente.
  // A exclusão em si é sempre segura: não há nenhuma outra tabela que dependa
  // do adiantamento (FK só existe DE adiantamentos PARA motoboys/motoristas/
  // profiles, nunca o contrário), então remover um registro nunca deixa dado
  // órfão nem quebra o cálculo de outros adiantamentos — cada um é somado de
  // forma independente a cada carregamento.
  async function _handleDeleteAdiantamento(id, container){
    var a = _adiantamentos.find(function(x){ return x.id === id; });
    if(!a) return;

    var msg;
    if(a.status === 'Descontado'){
      var qLabel = a.fechamento_quinzena === 1 ? '1ª Quinzena' : (a.fechamento_quinzena === 2 ? '2ª Quinzena' : '');
      var ondeFoi = (a.fechamento_mes && a.fechamento_ano)
        ? (MONTH_NAMES[a.fechamento_mes-1]+'/'+a.fechamento_ano+(qLabel ? ' — '+qLabel : ''))
        : 'um fechamento já processado';
      msg = 'Este adiantamento de '+_money(a.valor)+' já foi DESCONTADO em '+ondeFoi+'.\n\n'+
            'Excluí-lo o remove permanentemente do histórico: ele deixará de aparecer nos relatórios, PDFs e Excel exportados a partir de agora — inclusive nos totais daquele fechamento, caso o documento seja gerado novamente.\n\n'+
            'Esta ação não pode ser desfeita. Deseja continuar?';
    } else {
      msg = 'Excluir este adiantamento de '+_money(a.valor)+'?\n\nEsta ação não pode ser desfeita.';
    }

    var confirmed = window.confirm(msg);
    if(!confirmed) return;

    var result = await _repo.deleteAdiantamento(_companyId, id);
    if(result.error){ _toast(result.error.userMessage || 'Erro ao excluir adiantamento.'); return; }
    _toast('Adiantamento excluído.');
    await _loadAdiantamentos();
    _rerender(container);
  }

  // ─── Fechamento — fechamento mensal para pagamento dos motoboys ───────────
  // Mesmo padrão visual/UX do Fechamento de transportadoras: ranking do mês,
  // detalhamento diário ao expandir, e geração de PDF (individual e geral).

  function _fechMonthDateKeys(){
    var n = _daysInMonth(_fechYear, _fechMonth);
    var out = [];
    for(var d = 1; d <= n; d++) out.push(_isoDate(_fechYear, _fechMonth, d));
    return out;
  }

  function _fechQuinzenaKeys(which){
    var n = _daysInMonth(_fechYear, _fechMonth);
    var out = [];
    if(which === 1){
      for(var d = 1; d <= Math.min(15, n); d++) out.push(_isoDate(_fechYear, _fechMonth, d));
    } else {
      for(var d2 = 16; d2 <= n; d2++) out.push(_isoDate(_fechYear, _fechMonth, d2));
    }
    return out;
  }

  function _getFechEntry(dateKey, motoboyId, transp){
    return _fechEntries.find(function(e){
      return e.date_key === dateKey && e.motoboy_id === motoboyId && e.transportadora === transp;
    });
  }

  // Totais do mês agrupados por motoboy (ML/SH separados e valor a pagar)
  //
  // CORREÇÃO: antes este método filtrava só motoboys com status 'Ativo', o que fazia
  // o valor devido a um motoboy desligado NO MEIO DO MÊS desaparecer completamente do
  // Fechamento e da Folha de Pagamento Geral (PDF) - mesmo ele tendo trabalhado e tendo
  // lançamentos naquele mês. Os totais de quinzena (_sumFechEntriesValor) continuavam
  // somando esses valores, causando divergência entre "Total a Pagar" e as quinzenas,
  // e risco real de o motoboy não ser pago. Agora TODOS os motoboys com pelo menos um
  // lançamento no mês do fechamento entram no cálculo, independente do status atual.
  // Motoboys sem nenhum lançamento no mês (ativos ou não) continuam sendo omitidos da
  // lista pela checagem "mlQ === 0 && shQ === 0" já existente em _renderFechamento /
  // _generateFechGeralPDF / _generateMotoboyPDF.
  // Bruto (ML+SH) de UM motoboy em UMA quinzena específica do fechamento (which: 1 ou 2).
  // Extraído para ser reutilizado tanto pela tela de Fechamento quanto pelo PDF
  // individual (quinzenaSection), evitando duas implementações do mesmo cálculo.
  function _calcMotoboyQuinzenaBruto(motoboyId, which){
    var keys = _fechQuinzenaKeys(which);
    var mlQ = 0, shQ = 0, mlVal = 0, shVal = 0;
    keys.forEach(function(k){
      var eml = _getFechEntry(k, motoboyId, 'MERCADO LIVRE');
      var esh = _getFechEntry(k, motoboyId, 'SHOPEE');
      if(eml){ mlQ += parseInt(eml.quantidade_pacotes, 10) || 0; mlVal += parseFloat(eml.valor_motoboy) || 0; }
      if(esh){ shQ += parseInt(esh.quantidade_pacotes, 10) || 0; shVal += parseFloat(esh.valor_motoboy) || 0; }
    });
    return { mlQ: mlQ, shQ: shQ, mlVal: mlVal, shVal: shVal, total: Math.round((mlVal + shVal) * 100) / 100 };
  }

  // IMPORTANTE: o campo "total" (Pagamento Bruto do MÊS) NÃO é alterado — ele
  // continua sendo usado, sem mudanças, para ordenação, largura da barra e nos
  // PDFs já existentes.
  //
  // OS PAGAMENTOS SÃO FEITOS POR QUINZENA: por isso o desconto de Adiantamentos
  // (e o Pagamento Líquido) é calculado e aplicado POR QUINZENA em "quinzenas.1"
  // e "quinzenas.2" — nunca como uma parcela única do mês inteiro. Os campos
  // agregados do mês (adiantamentosPendentes, pagamentoLiquido) são apenas a
  // SOMA das duas quinzenas — mesma fonte de dados, sem duplicar cálculo —,
  // usados pelo Dashboard/Relatórios/CSV/PDF geral, que enxergam o mês como um
  // todo.
  function _calcFechMotoboyTotals(){
    var q1CutoffKey = _isoDate(_fechYear, _fechMonth, 15);
    var adiPorMotoboyQz = _repo.calcAdiantamentosPorMotoboyQuinzena(_adiantamentos, q1CutoffKey);
    return _motoboys.map(function(m){
      // q1Bruto + q2Bruto juntos já cobrem TODOS os dias do mês (dias 1–15 e
      // 16–fim), então o total mensal é derivado da soma das duas quinzenas —
      // em vez de percorrer o mês inteiro uma terceira vez.
      var q1Bruto = _calcMotoboyQuinzenaBruto(m.id, 1);
      var q2Bruto = _calcMotoboyQuinzenaBruto(m.id, 2);
      var mlQ = q1Bruto.mlQ + q2Bruto.mlQ;
      var shQ = q1Bruto.shQ + q2Bruto.shQ;
      var mlVal = q1Bruto.mlVal + q2Bruto.mlVal;
      var shVal = q1Bruto.shVal + q2Bruto.shVal;
      var total = Math.round((q1Bruto.total + q2Bruto.total) * 100) / 100;

      var adiQz = adiPorMotoboyQz[m.id] || { q1:{pendente:0,itensPendentes:[]}, q2:{pendente:0,itensPendentes:[]} };
      var q1Liquido = Math.round((q1Bruto.total - adiQz.q1.pendente) * 100) / 100;
      var q2Liquido = Math.round((q2Bruto.total - adiQz.q2.pendente) * 100) / 100;

      var adiantamentosPendentesMes = Math.round((adiQz.q1.pendente + adiQz.q2.pendente) * 100) / 100;
      var pagamentoLiquidoMes = Math.round((total - adiantamentosPendentesMes) * 100) / 100;

      return {
        id: m.id, name: m.nome, mlQ: mlQ, shQ: shQ, mlVal: mlVal, shVal: shVal, total: total,
        // Agregados do mês (soma das duas quinzenas) — usados fora do Fechamento
        // (Dashboard, Relatórios, CSV, PDF geral).
        adiantamentosPendentes: adiantamentosPendentesMes,
        pagamentoBruto: total,
        pagamentoLiquido: pagamentoLiquidoMes,
        // Detalhamento por quinzena — usado no Fechamento (tela e PDF individual)
        // para descontar os adiantamentos no momento correto do pagamento.
        quinzenas: {
          1: {
            mlQ: q1Bruto.mlQ, shQ: q1Bruto.shQ, mlVal: q1Bruto.mlVal, shVal: q1Bruto.shVal,
            bruto: q1Bruto.total,
            adiantamentosPendentes: adiQz.q1.pendente,
            adiantamentosPendentesIds: adiQz.q1.itensPendentes,
            liquido: q1Liquido
          },
          2: {
            mlQ: q2Bruto.mlQ, shQ: q2Bruto.shQ, mlVal: q2Bruto.mlVal, shVal: q2Bruto.shVal,
            bruto: q2Bruto.total,
            adiantamentosPendentes: adiQz.q2.pendente,
            adiantamentosPendentesIds: adiQz.q2.itensPendentes,
            liquido: q2Liquido
          }
        }
      };
    }).sort(function(a,b){ return b.total - a.total; });
  }

  // Totais do mês por MOTORISTA, na mesma "forma" de _calcFechMotoboyTotals
  // (quinzenas.1/.2 com bruto/adiantamentosPendentes/adiantamentosPendentesIds/
  // liquido), para que a tela de Fechamento e a lógica de desconto por
  // quinzena sejam reaproveitadas sem duplicação. A diferença é só a origem do
  // "bruto": em vez de pacotes ML/SH, é a diária (contada 1x por dia
  // trabalhado — mesma regra de _repo.calcDiariasPorMotorista).
  function _calcFechMotoristaTotals(){
    var q1CutoffKey = _isoDate(_fechYear, _fechMonth, 15);
    var adiPorMotoristaQz = _repo.calcAdiantamentosPorPessoaQuinzena(_adiantamentos, 'MOTORISTA', q1CutoffKey);

    var q1KeySet = {}, q2KeySet = {};
    _fechQuinzenaKeys(1).forEach(function(k){ q1KeySet[k] = true; });
    _fechQuinzenaKeys(2).forEach(function(k){ q2KeySet[k] = true; });
    var q1Entries = _fechEntries.filter(function(e){ return q1KeySet[e.date_key]; });
    var q2Entries = _fechEntries.filter(function(e){ return q2KeySet[e.date_key]; });
    var q1Diarias = _repo.calcDiariasPorMotorista(q1Entries);
    var q2Diarias = _repo.calcDiariasPorMotorista(q2Entries);

    function findDiaria(list, motoristaId){
      return list.find(function(x){ return x.motorista_id === motoristaId; });
    }

    return _motoristas.map(function(m){
      var q1d = findDiaria(q1Diarias, m.id) || { dias:0, valorDiaria: parseFloat(m.valor_diaria)||0, total:0 };
      var q2d = findDiaria(q2Diarias, m.id) || { dias:0, valorDiaria: parseFloat(m.valor_diaria)||0, total:0 };
      var total = Math.round((q1d.total + q2d.total) * 100) / 100;

      var adiQz = adiPorMotoristaQz[m.id] || { q1:{pendente:0,itensPendentes:[]}, q2:{pendente:0,itensPendentes:[]} };
      var q1Liquido = Math.round((q1d.total - adiQz.q1.pendente) * 100) / 100;
      var q2Liquido = Math.round((q2d.total - adiQz.q2.pendente) * 100) / 100;

      var adiantamentosPendentesMes = Math.round((adiQz.q1.pendente + adiQz.q2.pendente) * 100) / 100;
      var pagamentoLiquidoMes = Math.round((total - adiantamentosPendentesMes) * 100) / 100;

      return {
        id: m.id, name: m.nome, dias: q1d.dias + q2d.dias, valorDiaria: parseFloat(m.valor_diaria) || 0, total: total,
        adiantamentosPendentes: adiantamentosPendentesMes,
        pagamentoBruto: total,
        pagamentoLiquido: pagamentoLiquidoMes,
        quinzenas: {
          1: {
            dias: q1d.dias, bruto: q1d.total,
            adiantamentosPendentes: adiQz.q1.pendente,
            adiantamentosPendentesIds: adiQz.q1.itensPendentes,
            liquido: q1Liquido
          },
          2: {
            dias: q2d.dias, bruto: q2d.total,
            adiantamentosPendentes: adiQz.q2.pendente,
            adiantamentosPendentesIds: adiQz.q2.itensPendentes,
            liquido: q2Liquido
          }
        }
      };
    }).sort(function(a,b){ return b.total - a.total; });
  }

  function _renderFechamento(){
    var totals = _calcFechMotoboyTotals();
    var totalGeral = Math.round(totals.reduce(function(s,t){ return s + t.total; }, 0) * 100) / 100;
    var grandML = totals.reduce(function(s,t){ return s + t.mlQ; }, 0);
    var grandSH = totals.reduce(function(s,t){ return s + t.shQ; }, 0);
    var maxVal = Math.max.apply(null, totals.map(function(t){ return t.total; }).concat([1]));

    var totalsMotorista = _calcFechMotoristaTotals();
    var totalDiariasMes = Math.round(totalsMotorista.reduce(function(s,t){ return s + t.total; }, 0) * 100) / 100;
    var maxValMotorista = Math.max.apply(null, totalsMotorista.map(function(t){ return t.total; }).concat([1]));
    var totalAdiantamentosPendentesMotorista = Math.round(totalsMotorista.reduce(function(s,t){ return s + t.adiantamentosPendentes; }, 0) * 100) / 100;
    var totalLiquidoGeralMotorista = Math.round(totalsMotorista.reduce(function(s,t){ return s + t.pagamentoLiquido; }, 0) * 100) / 100;

    var q1Keys = _fechQuinzenaKeys(1), q2Keys = _fechQuinzenaKeys(2);
    var q1Total = _sumFechEntriesValor(q1Keys), q2Total = _sumFechEntriesValor(q2Keys);

    // Adiantamentos: soma o saldo pendente de cada motoboy já dividido pela
    // quinzena a que pertence (ver _calcFechMotoboyTotals / quinzenas.1 e .2),
    // pois o pagamento é feito quinzenalmente — nunca em uma parcela mensal única.
    var totalAdiantamentosPendentes = Math.round(totals.reduce(function(s,t){ return s + t.adiantamentosPendentes; }, 0) * 100) / 100;
    var totalLiquidoGeral = Math.round(totals.reduce(function(s,t){ return s + t.pagamentoLiquido; }, 0) * 100) / 100;
    var totalDescontadoNesteFechamento = Math.round(_adiantamentos.filter(function(a){
      return a.status === 'Descontado' && a.fechamento_mes === _fechMonth && a.fechamento_ano === _fechYear;
    }).reduce(function(s,a){ return s + (parseFloat(a.valor)||0); }, 0) * 100) / 100;

    var h = '<div class="mb-section">';
    h += '<div class="mb-cal-nav">';
    h += '<button class="mb-cal-nav-btn" data-mb-fech-nav="-1">‹</button>';
    h += '<div class="mb-cal-nav-title">'+MONTH_NAMES[_fechMonth-1]+' '+_fechYear+'</div>';
    h += '<button class="mb-cal-nav-btn" data-mb-fech-nav="1">›</button>';
    h += '</div>';

    h += '<button class="mb-fech-pdf-geral-btn" id="mb-gen-pdf-geral">'+_iconPDF()+' Gerar Folha de Pagamento Geral (PDF)</button>';
    h += '<button class="mb-fech-pdf-geral-btn" id="mb-gen-csv-fechamento">'+_iconCSV()+' Exportar Fechamento (Excel/CSV)</button>';
    if(_canManage && totalAdiantamentosPendentes > 0){
      h += '<button class="mb-fech-pdf-geral-btn" id="mb-descontar-todos-adi">'+_iconCheck()+' Descontar Todos os Adiantamentos de Motoboys ('+_money(totalAdiantamentosPendentes)+')</button>';
    }
    if(_canManage && totalAdiantamentosPendentesMotorista > 0){
      h += '<button class="mb-fech-pdf-geral-btn" id="mb-descontar-todos-adi-motorista">'+_iconCheck()+' Descontar Todos os Adiantamentos de Motoristas ('+_money(totalAdiantamentosPendentesMotorista)+')</button>';
    }

    h += '<div class="mb-kpi-grid">';
    h += _kpi('Pagamento Bruto (Motoboys)', _money(totalGeral), 'neg');
    h += _kpi('Adiantamentos Pendentes (Motoboys)', _money(totalAdiantamentosPendentes), 'neg');
    h += _kpi('Pagamento Líquido (Motoboys)', _money(totalLiquidoGeral), totalLiquidoGeral>=0?'pos':'neg');
    h += _kpi('Descontado neste Fechamento', _money(totalDescontadoNesteFechamento), 'pos');
    h += _kpi('Diárias Motoristas (Bruto)', _money(totalDiariasMes), 'neg');
    h += _kpi('Adiantamentos Pendentes (Motoristas)', _money(totalAdiantamentosPendentesMotorista), 'neg');
    h += _kpi('Pagamento Líquido (Motoristas)', _money(totalLiquidoGeralMotorista), totalLiquidoGeralMotorista>=0?'pos':'neg');
    h += _kpi('Pacotes ML', String(grandML), '');
    h += _kpi('Pacotes SH', String(grandSH), '');
    h += _kpi('Total Pacotes', String(grandML+grandSH), '');
    h += '</div>';

    h += '<div class="mb-rank-title mb-rank-title-fech">Fechamento por Motorista</div>';
    var anyDataMotorista = totalsMotorista.some(function(t){ return t.total > 0; });
    if(!anyDataMotorista){
      h += '<div class="empty-state">Nenhuma diária de motorista neste mês ainda.</div>';
    } else {
      totalsMotorista.forEach(function(t, i){
        if(t.total === 0) return;
        var w = maxValMotorista > 0 ? Math.round((t.total/maxValMotorista)*100) : 0;
        h += '<div class="fech-row"><div class="fech-bar" style="width:'+w+'%"></div><div class="fech-content">';
        h += '  <div class="fech-top"><div class="fech-name"><span class="fech-rank">'+String(i+1).padStart(2,'0')+'</span>'+_escapeHTML(t.name)+'</div><div class="fech-total">'+_money(t.total)+'</div></div>';
        h += '  <div class="fech-split"><span>Dias trabalhados <b>'+t.dias+'</b> · Diária '+_money(t.valorDiaria)+'</span></div>';
        [[1,'1ª Quinzena',t.quinzenas[1]],[2,'2ª Quinzena',t.quinzenas[2]]].forEach(function(item){
          var qn = item[0], qlabel = item[1], qd = item[2];
          h += '  <div class="fech-adi-summary">';
          h += '    <span class="fech-adi-qlabel">'+qlabel+'</span>';
          h += '    <span class="fech-adi-item">Bruto <b>'+_money(qd.bruto)+'</b></span>';
          if(qd.adiantamentosPendentes > 0){
            h += '    <span class="fech-adi-item neg">Adiantamentos <b>−'+_money(qd.adiantamentosPendentes)+'</b></span>';
            h += '    <span class="fech-adi-item liquido">Líquido <b>'+_money(qd.liquido)+'</b></span>';
          }
          h += '  </div>';
          if(_canManage && qd.adiantamentosPendentes > 0){
            h += '  <button class="mb-btn-sm fech-adi-btn" data-mb-descontar-adi-qz="'+_escapeAttr(t.id)+'" data-mb-qz="'+qn+'" data-mb-tipo-pessoa="MOTORISTA">Descontar da '+qlabel+'</button>';
          }
        });
        h += '</div></div>';
      });
    }

    h += '<div class="quinzena-grid-mb">';
    h += '  <div class="qz-card-mb"><div class="qtitle">1ª Quinzena (1–15)</div><div class="qz-line-mb"><span>A Pagar</span><span>'+_money(q1Total)+'</span></div></div>';
    h += '  <div class="qz-card-mb"><div class="qtitle">2ª Quinzena (16–fim)</div><div class="qz-line-mb"><span>A Pagar</span><span>'+_money(q2Total)+'</span></div></div>';
    h += '</div>';

    h += '<div class="mb-rank-title mb-rank-title-fech">Fechamento por Motoboy <span class="mb-rank-tag">'+grandML+' ML · '+grandSH+' SH</span></div>';

    var anyData = totals.some(function(t){ return t.total > 0; });
    if(!anyData){
      h += '<div class="empty-state">Nenhum lançamento neste mês ainda.</div>';
    } else {
      totals.forEach(function(t, i){
        if(t.mlQ === 0 && t.shQ === 0) return;
        var w = maxVal > 0 ? Math.round((t.total/maxVal)*100) : 0;
        var expanded = _expandedFechMotoboy === t.id;
        h += '<div class="fech-row" data-mb-fech-toggle="'+_escapeAttr(t.id)+'"><div class="fech-bar" style="width:'+w+'%"></div><div class="fech-content">';
        h += '  <div class="fech-top"><div class="fech-name"><span class="fech-rank">'+String(i+1).padStart(2,'0')+'</span>'+_escapeHTML(t.name)+'</div><div class="fech-total">'+_money(t.total)+'</div></div>';
        h += '  <div class="fech-split"><span>ML <b>'+t.mlQ+'</b> · '+_money(t.mlVal)+'</span><span>SH <b>'+t.shQ+'</b> · '+_money(t.shVal)+'</span></div>';
        [[1,'1ª Quinzena',t.quinzenas[1]],[2,'2ª Quinzena',t.quinzenas[2]]].forEach(function(item){
          var qn = item[0], qlabel = item[1], qd = item[2];
          if(qd.adiantamentosPendentes <= 0) return; // só mostra a quinzena que realmente tem vale a descontar
          h += '  <div class="fech-adi-summary">';
          h += '    <span class="fech-adi-qlabel">'+qlabel+'</span>';
          h += '    <span class="fech-adi-item">Bruto <b>'+_money(qd.bruto)+'</b></span>';
          h += '    <span class="fech-adi-item neg">Adiantamentos <b>−'+_money(qd.adiantamentosPendentes)+'</b></span>';
          h += '    <span class="fech-adi-item liquido">Líquido <b>'+_money(qd.liquido)+'</b></span>';
          h += '  </div>';
          if(_canManage){
            h += '  <button class="mb-btn-sm fech-adi-btn" data-mb-descontar-adi-qz="'+_escapeAttr(t.id)+'" data-mb-qz="'+qn+'" data-mb-tipo-pessoa="MOTOBOY">Descontar da '+qlabel+'</button>';
          }
        });
        h += '  <div class="fech-pdf-hint">'+(expanded?'▾ contagem de pacotes por dia':'▸ toque para ver a contagem de pacotes por dia')+'</div>';
        if(expanded) h += _renderFechMotoboyDaily(t.id);
        h += '</div></div>';
      });
    }
    h += '</div>';
    return h;
  }

  function _sumFechEntriesValor(keys){
    var keySet = {};
    keys.forEach(function(k){ keySet[k] = true; });
    var total = 0;
    _fechEntries.forEach(function(e){ if(keySet[e.date_key]) total += parseFloat(e.valor_motoboy) || 0; });
    return Math.round(total * 100) / 100;
  }

  // Contagem diária de pacotes (ML/SH) de um motoboy no mês do Fechamento
  function _renderFechMotoboyDaily(motoboyId){
    var keys = _fechMonthDateKeys();
    var rows = keys.map(function(k){
      var eml = _getFechEntry(k, motoboyId, 'MERCADO LIVRE');
      var esh = _getFechEntry(k, motoboyId, 'SHOPEE');
      var ml = eml ? (parseInt(eml.quantidade_pacotes,10)||0) : 0;
      var sh = esh ? (parseInt(esh.quantidade_pacotes,10)||0) : 0;
      if(ml === 0 && sh === 0) return null;
      var val = (eml ? (parseFloat(eml.valor_motoboy)||0) : 0) + (esh ? (parseFloat(esh.valor_motoboy)||0) : 0);
      return { key: k, ml: ml, sh: sh, val: val };
    }).filter(Boolean);

    var h = '<div class="fech-daily-panel">';
    if(rows.length === 0){
      h += '<div class="fech-daily-empty">Nenhum pacote lançado para este motoboy neste mês.</div>';
    } else {
      rows.forEach(function(row){
        h += '<div class="fech-daily-row">';
        h += '  <span class="fech-daily-date">dia '+_brDateShortYear(row.key)+'</span>';
        h += '  <span class="fech-daily-qtd">'+row.ml+' ML e '+row.sh+' SH</span>';
        h += '  <span class="fech-daily-val">'+_money(row.val)+'</span>';
        h += '</div>';
      });
    }
    h += '<button class="fech-gen-pdf-btn" data-mb-fech-pdf="'+_escapeAttr(motoboyId)+'">'+_iconPDF()+' Gerar PDF completo deste motoboy</button>';
    h += '</div>';
    return h;
  }

  function _brDateShortYear(iso){ var p = iso.split('-'); return p[2]+'/'+p[1]+'/'+p[0].slice(2); }
  function _brDateShort(iso){ var p = iso.split('-'); return p[2]+'/'+p[1]; }
  function _fmt2(n){ return (parseFloat(n)||0).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }); }

  function _iconPDF(){
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  }

  function _iconCSV(){
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>';
  }

  function _iconCheck(){
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
  }

  // ─── Geração de PDF — fechamento individual do motoboy (padrão das transportadoras) ─

  function _generateMotoboyPDF(motoboyId){
    if(!window.jspdf){ _toast('Biblioteca de PDF ainda carregando, tente novamente em instantes.'); return; }
    var m = _motoboys.find(function(x){ return x.id === motoboyId; });
    if(!m){ _toast('Motoboy não encontrado.'); return; }
    var mlRate = _getRate(motoboyId, 'MERCADO LIVRE');
    var shRate = _getRate(motoboyId, 'SHOPEE');

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit:'pt', format:'a4' });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 40;
    var y = margin;

    function checkPage(need){ if(y + need > pageH - margin){ doc.addPage(); y = margin; } }

    // Pré-calcula os totais (inclui o detalhamento por quinzena) uma única vez,
    // reaproveitado tanto pela 1ª quanto pela 2ª quinzena abaixo.
    var tSelf = _calcFechMotoboyTotals().find(function(x){ return x.id === motoboyId; });

    function quinzenaSection(which, label){
      var keys = _fechQuinzenaKeys(which);
      if(keys.length === 0) return;
      checkPage(80);

      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 20, 'F');
      doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(11);
      doc.text('GM FLEX  –  MOTOBOY: '+m.nome, pageW/2, y+14, {align:'center'});
      y += 20;

      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 18, 'F');
      doc.setFontSize(9.5);
      doc.text('FECHAMENTO PARA PAGAMENTO  –  '+label+' '+MONTH_NAMES[_fechMonth-1].toUpperCase()+'/'+_fechYear, pageW/2, y+12.5, {align:'center'});
      y += 26;

      var halfW = (pageW-2*margin)/2;
      doc.setFillColor(228,235,242); doc.setDrawColor(178,190,202);
      doc.rect(margin, y, halfW, 17, 'FD');
      doc.rect(margin+halfW, y, halfW, 17, 'FD');
      doc.setTextColor(20,20,20); doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
      doc.text('TAXA ML:  '+_fmt2(mlRate), margin+8, y+11.5);
      doc.text('TAXA SH:  '+_fmt2(shRate), margin+halfW+8, y+11.5);
      y += 23;

      var cols = ['DATA','ENTREGAS ML','ENTREGAS SH','VALOR ML','VALOR SH','TOTAL'];
      var widths = [64,72,72,102,102,103];
      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 16, 'F');
      doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
      var x = margin;
      cols.forEach(function(c,i){ doc.text(c, x+widths[i]/2, y+11, {align:'center'}); x += widths[i]; });
      y += 16;

      var totML=0, totSH=0, totValML=0, totValSH=0, totVal=0;
      keys.forEach(function(k, idx){
        checkPage(15);
        var eml = _getFechEntry(k, motoboyId, 'MERCADO LIVRE');
        var esh = _getFechEntry(k, motoboyId, 'SHOPEE');
        var ml = eml ? (parseInt(eml.quantidade_pacotes,10)||0) : 0;
        var sh = esh ? (parseInt(esh.quantidade_pacotes,10)||0) : 0;
        var parts = k.split('-');
        var sun = _isSunday(parseInt(parts[0],10), parseInt(parts[1],10), parseInt(parts[2],10));
        var isOff = sun && !eml && !esh;

        doc.setFillColor(idx%2===0?255:247, idx%2===0?255:246, idx%2===0?255:241);
        doc.rect(margin, y, pageW-2*margin, 15, 'F');
        doc.setDrawColor(228,226,218); doc.rect(margin, y, pageW-2*margin, 15);
        doc.setTextColor(30,30,30); doc.setFont('helvetica','normal'); doc.setFontSize(8);
        var xx = margin;
        doc.text(_brDateShort(k), xx+widths[0]/2, y+10, {align:'center'}); xx += widths[0];
        if(isOff){
          doc.setFont('helvetica','bold');
          doc.text('DOMINGO', xx+5, y+10);
          xx += widths[1]+widths[2];
          doc.setFont('helvetica','normal');
          doc.text('R$   -', xx+widths[3]/2, y+10, {align:'center'}); xx += widths[3];
          doc.text('R$   -', xx+widths[4]/2, y+10, {align:'center'}); xx += widths[4];
          doc.text('R$   -', xx+widths[5]/2, y+10, {align:'center'});
        } else {
          var vml = eml ? (parseFloat(eml.valor_motoboy)||0) : 0;
          var vsh = esh ? (parseFloat(esh.valor_motoboy)||0) : 0;
          var tot = vml + vsh;
          totML += ml; totSH += sh; totValML += vml; totValSH += vsh; totVal += tot;
          doc.text(String(ml), xx+widths[1]/2, y+10, {align:'center'}); xx += widths[1];
          doc.text(String(sh), xx+widths[2]/2, y+10, {align:'center'}); xx += widths[2];
          doc.text('R$ '+_fmt2(vml), xx+widths[3]/2, y+10, {align:'center'}); xx += widths[3];
          doc.text('R$ '+_fmt2(vsh), xx+widths[4]/2, y+10, {align:'center'}); xx += widths[4];
          doc.text('R$ '+_fmt2(tot), xx+widths[5]/2, y+10, {align:'center'});
        }
        y += 15;
      });

      checkPage(34);
      var sumCols = ['Qnt','ML','SH','TOTAL PCT','TOTAL A PAGAR'];
      var sumWidths = [64,72,72,102,205];
      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 15, 'F');
      doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
      var sx = margin;
      sumCols.forEach(function(c,i){ doc.text(c, sx+sumWidths[i]/2, y+10, {align:'center'}); sx += sumWidths[i]; });
      y += 15;

      doc.setFillColor(250,222,193); doc.setDrawColor(224,198,168);
      doc.rect(margin, y, pageW-2*margin, 15, 'FD');
      doc.setTextColor(30,30,30); doc.setFont('helvetica','bold'); doc.setFontSize(8);
      sx = margin;
      doc.text(String(totML), sx+sumWidths[0]+sumWidths[1]/2, y+10, {align:'center'});
      doc.text(String(totSH), sx+sumWidths[0]+sumWidths[1]+sumWidths[2]/2, y+10, {align:'center'});
      doc.text(String(totML+totSH), sx+sumWidths[0]+sumWidths[1]+sumWidths[2]+sumWidths[3]/2, y+10, {align:'center'});
      y += 15;

      doc.setFillColor(255,255,255); doc.setDrawColor(228,226,218);
      doc.rect(margin, y, pageW-2*margin, 16, 'FD');
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(30,30,30);
      sx = margin + sumWidths[0];
      doc.text('R$ '+_fmt2(totValML), sx+sumWidths[1]/2, y+11, {align:'center'}); sx += sumWidths[1];
      doc.text('R$ '+_fmt2(totValSH), sx+sumWidths[2]/2, y+11, {align:'center'}); sx += sumWidths[2];
      doc.text('R$ '+_fmt2(totVal), sx+sumWidths[3]/2, y+11, {align:'center'}); sx += sumWidths[3];
      doc.setTextColor(190,32,22); doc.setFont('helvetica','bold'); doc.setFontSize(9.5);
      doc.text('R$ '+_fmt2(totVal), sx+sumWidths[4]/2, y+11.5, {align:'center'});
      y += 30;

      // ── Adiantamentos descontados NESTA quinzena (pagamento é quinzenal) ───
      var qd = tSelf ? tSelf.quinzenas[which] : null;
      if(qd && qd.adiantamentosPendentes > 0){
        checkPage(52);
        doc.setFillColor(43,74,110);
        doc.rect(margin, y, pageW-2*margin, 16, 'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
        doc.text('ADIANTAMENTOS DESTA QUINZENA', pageW/2, y+11, {align:'center'});
        y += 16;

        var rw = (pageW-2*margin)/3;
        doc.setFillColor(247,246,241); doc.setDrawColor(228,226,218);
        doc.rect(margin, y, rw, 28, 'FD');
        doc.rect(margin+rw, y, rw, 28, 'FD');
        doc.rect(margin+rw*2, y, rw, 28, 'FD');
        doc.setTextColor(90,90,90); doc.setFont('helvetica','normal'); doc.setFontSize(7);
        doc.text('PAGAMENTO BRUTO', margin+rw/2, y+10, {align:'center'});
        doc.text('ADIANTAMENTOS', margin+rw+rw/2, y+10, {align:'center'});
        doc.text('PAGAMENTO LIQUIDO', margin+rw*2+rw/2, y+10, {align:'center'});
        doc.setFont('helvetica','bold'); doc.setFontSize(10);
        doc.setTextColor(30,30,30);
        doc.text('R$ '+_fmt2(qd.bruto), margin+rw/2, y+21, {align:'center'});
        doc.setTextColor(190,32,22);
        doc.text('- R$ '+_fmt2(qd.adiantamentosPendentes), margin+rw+rw/2, y+21, {align:'center'});
        doc.setTextColor(43,74,110);
        doc.text('R$ '+_fmt2(qd.liquido), margin+rw*2+rw/2, y+21, {align:'center'});
        y += 36;
      }
    }

    quinzenaSection(1, '1ª QUINZENA');
    quinzenaSection(2, '2ª QUINZENA');

    // Espaço para assinatura de recebimento
    checkPage(60);
    y += 20;
    doc.setDrawColor(150,150,150);
    doc.line(margin, y, margin+220, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(80,80,80);
    doc.text('Assinatura do Motoboy', margin, y+12);
    doc.line(pageW-margin-220, y, pageW-margin, y);
    doc.text('Assinatura do Responsável', pageW-margin-220, y+12);

    doc.save('GMFLEX_MOTOBOY_'+m.nome.replace(/\s+/g,'_')+'_'+MONTH_NAMES[_fechMonth-1]+'_'+_fechYear+'.pdf');
  }

  // ─── Geração de PDF — folha de pagamento geral (todos os motoboys do mês) ─

  function _generateFechGeralPDF(){
    if(!window.jspdf){ _toast('Biblioteca de PDF ainda carregando, tente novamente em instantes.'); return; }
    var totals = _calcFechMotoboyTotals().filter(function(t){ return t.mlQ > 0 || t.shQ > 0; });

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit:'pt', format:'a4' });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 40;
    var y = margin;

    function checkPage(need){ if(y + need > pageH - margin){ doc.addPage(); y = margin; } }

    doc.setFillColor(43,74,110);
    doc.rect(margin, y, pageW-2*margin, 20, 'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text('GM FLEX  –  FOLHA DE PAGAMENTO DOS MOTOBOYS', pageW/2, y+14, {align:'center'});
    y += 20;

    doc.setFillColor(43,74,110);
    doc.rect(margin, y, pageW-2*margin, 18, 'F');
    doc.setFontSize(9.5);
    doc.text('FECHAMENTO MENSAL  –  '+MONTH_NAMES[_fechMonth-1].toUpperCase()+'/'+_fechYear, pageW/2, y+12.5, {align:'center'});
    y += 30;

    var cols = ['MOTOBOY','PACOTES ML','PACOTES SH','VALOR ML','VALOR SH','TOTAL A PAGAR'];
    var widths = [110,72,72,90,90,89];
    doc.setFillColor(43,74,110);
    doc.rect(margin, y, pageW-2*margin, 16, 'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
    var x = margin;
    cols.forEach(function(c,i){ doc.text(c, x+widths[i]/2, y+11, {align:'center'}); x += widths[i]; });
    y += 16;

    var grandML=0, grandSH=0, grandValML=0, grandValSH=0, grandTotal=0;
    if(totals.length === 0){
      checkPage(16);
      doc.setTextColor(90,90,90); doc.setFont('helvetica','normal'); doc.setFontSize(9);
      doc.text('Nenhum lançamento neste mês.', pageW/2, y+14, {align:'center'});
      y += 20;
    } else {
      totals.forEach(function(t, idx){
        checkPage(15);
        doc.setFillColor(idx%2===0?255:247, idx%2===0?255:246, idx%2===0?255:241);
        doc.rect(margin, y, pageW-2*margin, 15, 'F');
        doc.setDrawColor(228,226,218); doc.rect(margin, y, pageW-2*margin, 15);
        doc.setTextColor(30,30,30); doc.setFont('helvetica','normal'); doc.setFontSize(8);
        var xx = margin;
        doc.text(t.name, xx+6, y+10); xx += widths[0];
        doc.text(String(t.mlQ), xx+widths[1]/2, y+10, {align:'center'}); xx += widths[1];
        doc.text(String(t.shQ), xx+widths[2]/2, y+10, {align:'center'}); xx += widths[2];
        doc.text('R$ '+_fmt2(t.mlVal), xx+widths[3]/2, y+10, {align:'center'}); xx += widths[3];
        doc.text('R$ '+_fmt2(t.shVal), xx+widths[4]/2, y+10, {align:'center'}); xx += widths[4];
        doc.setFont('helvetica','bold');
        doc.text('R$ '+_fmt2(t.total), xx+widths[5]/2, y+10, {align:'center'});
        y += 15;
        grandML += t.mlQ; grandSH += t.shQ; grandValML += t.mlVal; grandValSH += t.shVal; grandTotal += t.total;
      });
    }

    checkPage(20);
    doc.setFillColor(250,222,193); doc.setDrawColor(224,198,168);
    doc.rect(margin, y, pageW-2*margin, 18, 'FD');
    doc.setTextColor(30,30,30); doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
    var sx = margin;
    doc.text('TOTAL GERAL', sx+widths[0]/2, y+12, {align:'center'}); sx += widths[0];
    doc.text(String(grandML), sx+widths[1]/2, y+12, {align:'center'}); sx += widths[1];
    doc.text(String(grandSH), sx+widths[2]/2, y+12, {align:'center'}); sx += widths[2];
    doc.text('R$ '+_fmt2(grandValML), sx+widths[3]/2, y+12, {align:'center'}); sx += widths[3];
    doc.text('R$ '+_fmt2(grandValSH), sx+widths[4]/2, y+12, {align:'center'}); sx += widths[4];
    doc.setTextColor(190,32,22); doc.setFontSize(9.5);
    doc.text('R$ '+_fmt2(grandTotal), sx+widths[5]/2, y+12.5, {align:'center'});
    y += 34;

    // ── Seção: Adiantamentos e Pagamento Líquido — POR QUINZENA ────────────
    // Não altera grandTotal/totalCombinado acima (o custo bruto da empresa com
    // motoboys não muda pela existência de adiantamentos — o dinheiro do vale já
    // saiu do caixa antes; isso só afeta quanto será pago EM MÃOS em cada
    // quinzena). Os pagamentos são feitos quinzenalmente, então o desconto
    // aparece separado por quinzena — nunca como uma parcela única do mês.
    function adiantamentosQuinzenaTable(totalsArr, pessoaColLabel, which, label){
      var rows = totalsArr.filter(function(t){ return t.quinzenas[which].adiantamentosPendentes > 0; });
      if(rows.length === 0) return;
      y += 10;
      checkPage(34);
      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 18, 'F');
      doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(9.5);
      doc.text('ADIANTAMENTOS E PAGAMENTO LÍQUIDO — '+label, pageW/2, y+12.5, {align:'center'});
      y += 18;

      var aCols = [pessoaColLabel,'PAGAMENTO BRUTO','ADIANTAMENTOS','PAGAMENTO LÍQUIDO'];
      var aWidths = [140,125,125,125];
      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 16, 'F');
      doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
      var ax = margin;
      aCols.forEach(function(c,i){ doc.text(c, ax+aWidths[i]/2, y+11, {align:'center'}); ax += aWidths[i]; });
      y += 16;

      var grandBrutoAdi=0, grandAdi=0, grandLiq=0;
      rows.forEach(function(t, idx){
        checkPage(15);
        var qd = t.quinzenas[which];
        doc.setFillColor(idx%2===0?255:247, idx%2===0?255:246, idx%2===0?255:241);
        doc.rect(margin, y, pageW-2*margin, 15, 'F');
        doc.setDrawColor(228,226,218); doc.rect(margin, y, pageW-2*margin, 15);
        doc.setTextColor(30,30,30); doc.setFont('helvetica','normal'); doc.setFontSize(8);
        var aax = margin;
        doc.text(t.name, aax+6, y+10); aax += aWidths[0];
        doc.text('R$ '+_fmt2(qd.bruto), aax+aWidths[1]/2, y+10, {align:'center'}); aax += aWidths[1];
        doc.setTextColor(190,32,22);
        doc.text('- R$ '+_fmt2(qd.adiantamentosPendentes), aax+aWidths[2]/2, y+10, {align:'center'}); aax += aWidths[2];
        doc.setTextColor(30,30,30); doc.setFont('helvetica','bold');
        doc.text('R$ '+_fmt2(qd.liquido), aax+aWidths[3]/2, y+10, {align:'center'});
        y += 15;
        grandBrutoAdi += qd.bruto; grandAdi += qd.adiantamentosPendentes; grandLiq += qd.liquido;
      });

      checkPage(20);
      doc.setFillColor(250,222,193); doc.setDrawColor(224,198,168);
      doc.rect(margin, y, pageW-2*margin, 18, 'FD');
      doc.setTextColor(30,30,30); doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
      var asx = margin;
      doc.text('TOTAL', asx+aWidths[0]/2, y+12, {align:'center'}); asx += aWidths[0];
      doc.text('R$ '+_fmt2(grandBrutoAdi), asx+aWidths[1]/2, y+12, {align:'center'}); asx += aWidths[1];
      doc.setTextColor(190,32,22);
      doc.text('- R$ '+_fmt2(grandAdi), asx+aWidths[2]/2, y+12, {align:'center'}); asx += aWidths[2];
      doc.setTextColor(30,30,30); doc.setFontSize(9.5);
      doc.text('R$ '+_fmt2(grandLiq), asx+aWidths[3]/2, y+12.5, {align:'center'});
      y += 34;
    }

    adiantamentosQuinzenaTable(totals, 'MOTOBOY', 1, '1ª QUINZENA');
    adiantamentosQuinzenaTable(totals, 'MOTOBOY', 2, '2ª QUINZENA');

    // ── Seção: Diárias de Motoristas ──────────────────────────────────────
    var diarias = _repo.calcDiariasPorMotorista(_fechEntries);
    var totalDiarias = Math.round(diarias.reduce(function(s,d){ return s + d.total; }, 0) * 100) / 100;

    if(diarias.length > 0){
      y += 10;
      checkPage(34);
      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 18, 'F');
      doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(9.5);
      doc.text('DIÁRIAS DE MOTORISTAS', pageW/2, y+12.5, {align:'center'});
      y += 18;

      var dCols = ['MOTORISTA','DIAS TRABALHADOS','VALOR DA DIÁRIA','TOTAL A PAGAR'];
      var dWidths = [180,110,110,133];
      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 16, 'F');
      doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(8);
      var dx = margin;
      dCols.forEach(function(c,i){ doc.text(c, dx+dWidths[i]/2, y+11, {align:'center'}); dx += dWidths[i]; });
      y += 16;

      diarias.forEach(function(d, idx){
        checkPage(15);
        doc.setFillColor(idx%2===0?255:247, idx%2===0?255:246, idx%2===0?255:241);
        doc.rect(margin, y, pageW-2*margin, 15, 'F');
        doc.setDrawColor(228,226,218); doc.rect(margin, y, pageW-2*margin, 15);
        doc.setTextColor(30,30,30); doc.setFont('helvetica','normal'); doc.setFontSize(8);
        var ddx = margin;
        doc.text(d.nome, ddx+6, y+10); ddx += dWidths[0];
        doc.text(String(d.dias), ddx+dWidths[1]/2, y+10, {align:'center'}); ddx += dWidths[1];
        doc.text('R$ '+_fmt2(d.valorDiaria), ddx+dWidths[2]/2, y+10, {align:'center'}); ddx += dWidths[2];
        doc.setFont('helvetica','bold');
        doc.text('R$ '+_fmt2(d.total), ddx+dWidths[3]/2, y+10, {align:'center'});
        y += 15;
      });

      checkPage(20);
      doc.setFillColor(250,222,193); doc.setDrawColor(224,198,168);
      doc.rect(margin, y, pageW-2*margin, 18, 'FD');
      doc.setTextColor(30,30,30); doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
      doc.text('TOTAL DIÁRIAS', margin+(dWidths[0]+dWidths[1])/2, y+12, {align:'center'});
      doc.setTextColor(190,32,22); doc.setFontSize(9.5);
      doc.text('R$ '+_fmt2(totalDiarias), margin+dWidths[0]+dWidths[1]+dWidths[2]+dWidths[3]/2, y+12.5, {align:'center'});
      y += 34;
    }

    var totalsMotoristaPdf = _calcFechMotoristaTotals();
    adiantamentosQuinzenaTable(totalsMotoristaPdf, 'MOTORISTA', 1, '1ª QUINZENA (MOTORISTAS)');
    adiantamentosQuinzenaTable(totalsMotoristaPdf, 'MOTORISTA', 2, '2ª QUINZENA (MOTORISTAS)');

    // ── Total Geral combinado (Motoboys + Motoristas) ─────────────────────
    checkPage(22);
    var totalCombinado = Math.round((grandTotal + totalDiarias) * 100) / 100;
    doc.setFillColor(43,74,110);
    doc.rect(margin, y, pageW-2*margin, 20, 'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text('TOTAL GERAL A PAGAR (MOTOBOYS + MOTORISTAS): R$ '+_fmt2(totalCombinado), pageW/2, y+14, {align:'center'});
    y += 30;

    checkPage(20);
    doc.setFont('helvetica','italic'); doc.setFontSize(7.5); doc.setTextColor(120,120,120);
    doc.text('Gerado em '+new Date().toLocaleDateString('pt-BR')+' às '+new Date().toLocaleTimeString('pt-BR').slice(0,5)+' pelo sistema GM FLEX.', margin, y);

    doc.save('GMFLEX_FOLHA_PAGAMENTO_MOTOBOYS_'+MONTH_NAMES[_fechMonth-1]+'_'+_fechYear+'.pdf');
  }

  // ─── Exportação Excel (.csv) do Fechamento — inclui Adiantamentos ────────
  // Mesmo padrão de exportação usado no restante do sistema (app.js/doExcelExport):
  // separador ";" e vírgula decimal para abrir corretamente no Excel em pt-BR,
  // BOM UTF-8 no início do arquivo.
  function _generateFechamentoCSV(){
    var totals = _calcFechMotoboyTotals().filter(function(t){ return t.mlQ > 0 || t.shQ > 0 || t.adiantamentosPendentes > 0; });
    var lines = ['Motoboy;Pacotes ML;Pacotes SH;Valor ML;Valor SH;Pagamento Bruto;Adiantamentos Pendentes;Pagamento Liquido'];
    var grandBruto=0, grandAdi=0, grandLiq=0;
    totals.forEach(function(t){
      lines.push([
        t.name, t.mlQ, t.shQ,
        _fmt2(t.mlVal).replace('.', ','), _fmt2(t.shVal).replace('.', ','),
        _fmt2(t.pagamentoBruto).replace('.', ','),
        _fmt2(t.adiantamentosPendentes).replace('.', ','),
        _fmt2(t.pagamentoLiquido).replace('.', ',')
      ].join(';'));
      grandBruto += t.pagamentoBruto; grandAdi += t.adiantamentosPendentes; grandLiq += t.pagamentoLiquido;
    });
    lines.push('TOTAL GERAL;;;;;'+_fmt2(grandBruto).replace('.',',')+';'+_fmt2(grandAdi).replace('.',',')+';'+_fmt2(grandLiq).replace('.',','));

    // Pagamento é feito por quinzena — detalha o desconto de adiantamentos
    // separado por 1ª/2ª quinzena (mesma lógica usada na tela de Fechamento e
    // nos PDFs), em vez de uma única parcela mensal.
    var linhasQuinzena = [];
    totals.forEach(function(t){
      [[1,'1ª Quinzena'],[2,'2ª Quinzena']].forEach(function(item){
        var qd = t.quinzenas[item[0]];
        if(qd.bruto <= 0 && qd.adiantamentosPendentes <= 0) return;
        linhasQuinzena.push([
          t.name, item[1],
          _fmt2(qd.bruto).replace('.', ','),
          _fmt2(qd.adiantamentosPendentes).replace('.', ','),
          _fmt2(qd.liquido).replace('.', ',')
        ].join(';'));
      });
    });
    if(linhasQuinzena.length > 0){
      lines.push('');
      lines.push('Adiantamentos e Pagamento Liquido por Quinzena');
      lines.push('Motoboy;Quinzena;Pagamento Bruto;Adiantamentos;Pagamento Liquido');
      linhasQuinzena.forEach(function(l){ lines.push(l); });
    }

    var totalsMotorista = _calcFechMotoristaTotals().filter(function(t){ return t.total > 0 || t.adiantamentosPendentes > 0; });
    if(totalsMotorista.length > 0){
      lines.push('');
      lines.push('Fechamento de Motoristas (Diarias)');
      lines.push('Motorista;Dias Trabalhados;Valor da Diaria;Pagamento Bruto;Adiantamentos Pendentes;Pagamento Liquido');
      var grandBrutoM=0, grandAdiM=0, grandLiqM=0;
      totalsMotorista.forEach(function(t){
        lines.push([
          t.name, t.dias, _fmt2(t.valorDiaria).replace('.', ','),
          _fmt2(t.pagamentoBruto).replace('.', ','),
          _fmt2(t.adiantamentosPendentes).replace('.', ','),
          _fmt2(t.pagamentoLiquido).replace('.', ',')
        ].join(';'));
        grandBrutoM += t.pagamentoBruto; grandAdiM += t.adiantamentosPendentes; grandLiqM += t.pagamentoLiquido;
      });
      lines.push('TOTAL GERAL;;;'+_fmt2(grandBrutoM).replace('.',',')+';'+_fmt2(grandAdiM).replace('.',',')+';'+_fmt2(grandLiqM).replace('.',','));

      var linhasQuinzenaMotorista = [];
      totalsMotorista.forEach(function(t){
        [[1,'1ª Quinzena'],[2,'2ª Quinzena']].forEach(function(item){
          var qd = t.quinzenas[item[0]];
          if(qd.bruto <= 0 && qd.adiantamentosPendentes <= 0) return;
          linhasQuinzenaMotorista.push([
            t.name, item[1],
            _fmt2(qd.bruto).replace('.', ','),
            _fmt2(qd.adiantamentosPendentes).replace('.', ','),
            _fmt2(qd.liquido).replace('.', ',')
          ].join(';'));
        });
      });
      if(linhasQuinzenaMotorista.length > 0){
        lines.push('');
        lines.push('Adiantamentos e Pagamento Liquido por Quinzena (Motoristas)');
        lines.push('Motorista;Quinzena;Pagamento Bruto;Adiantamentos;Pagamento Liquido');
        linhasQuinzenaMotorista.forEach(function(l){ lines.push(l); });
      }
    }

    var pendentes = _adiantamentos.filter(function(a){ return a.status === 'Pendente'; });
    if(pendentes.length > 0){
      lines.push('');
      lines.push('Detalhamento de Adiantamentos Pendentes (Motoboys e Motoristas)');
      lines.push('Data;Tipo;Pessoa;Motivo;Valor;Observacao;Usuario Responsavel');
      pendentes.forEach(function(a){
        var tipo = _adiTipo(a);
        var nome = _pessoaNome(tipo, _adiPessoaId(a));
        var motivoSafe = String(a.motivo||'').replace(/;/g, ',').replace(/[\r\n]+/g,' ');
        var obsSafe = String(a.observacao||'').replace(/;/g, ',').replace(/[\r\n]+/g,' ');
        lines.push([_brDate(a.data_key), _pessoaLabel(tipo), nome, motivoSafe, _fmt2(a.valor).replace('.', ','), obsSafe, a.usuario_nome||''].join(';'));
      });
    }

    var blob = new Blob(['\ufeff'+lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'GMFLEX_FECHAMENTO_MOTOBOYS_'+MONTH_NAMES[_fechMonth-1]+'_'+_fechYear+'.csv';
    a.click();
    _toast('Planilha exportada.');
  }

  // ─── Adiantamentos — marcar como Descontado no fechamento (POR QUINZENA) ──
  // Ação explícita (não automática): o gestor confirma o desconto dos
  // adiantamentos pendentes de um motoboy, NUMA quinzena específica (ou de
  // todos, já separados por quinzena), no momento de fechar aquele pagamento.
  // A partir daí eles somem do saldo pendente e nunca mais entram novamente no
  // cálculo do pagamento líquido (evita desconto duplicado).
  // Totais do fechamento (por pessoa/quinzena) de acordo com o tipo — reusa
  // _calcFechMotoboyTotals (pacotes ML/SH) ou _calcFechMotoristaTotals
  // (diárias), que produzem a mesma "forma" de objeto (quinzenas.1/.2 com
  // adiantamentosPendentes/adiantamentosPendentesIds/liquido), permitindo que
  // toda a lógica de desconto abaixo seja única para os dois tipos.
  function _calcFechTotals(tipoPessoa){
    return tipoPessoa === 'MOTORISTA' ? _calcFechMotoristaTotals() : _calcFechMotoboyTotals();
  }

  async function _handleDescontarAdiantamentosPessoaQuinzena(tipoPessoa, pessoaId, which, container){
    which = parseInt(which, 10);
    var totals = _calcFechTotals(tipoPessoa);
    var t = totals.find(function(x){ return x.id === pessoaId; });
    var qd = t ? t.quinzenas[which] : null;
    if(!qd || !qd.adiantamentosPendentesIds || qd.adiantamentosPendentesIds.length === 0){
      _toast('Nenhum adiantamento pendente nesta quinzena para est'+(tipoPessoa==='MOTORISTA'?'e motorista':'e motoboy')+'.');
      return;
    }
    var qlabel = which === 1 ? '1ª Quinzena' : '2ª Quinzena';
    var confirmed = window.confirm('Confirmar o desconto de '+_money(qd.adiantamentosPendentes)+' em adiantamentos de "'+t.name+'" na '+qlabel+'?\n\nOs adiantamentos serão marcados como Descontados e não entrarão novamente no cálculo do pagamento líquido.');
    if(!confirmed) return;
    var result = await _repo.marcarAdiantamentosDescontados(_companyId, qd.adiantamentosPendentesIds, _fechMonth, _fechYear, which);
    if(result.error){ _toast(result.error.userMessage || 'Erro ao descontar adiantamentos.'); return; }
    _toast('Adiantamentos da '+qlabel+' de '+t.name+' descontados com sucesso.');
    await _loadAdiantamentos();
    _rerender(container);
  }

  // Retrocompatível: mesma assinatura/comportamento de antes da generalização.
  async function _handleDescontarAdiantamentosQuinzena(motoboyId, which, container){
    return _handleDescontarAdiantamentosPessoaQuinzena('MOTOBOY', motoboyId, which, container);
  }

  // Precisa de UMA chamada por quinzena, pois cada item só pode ser marcado
  // com um único fechamento_quinzena — não dá para misturar ids da 1ª e da 2ª
  // quinzena numa única atualização em lote.
  function _agregarIdsPendentesPorQuinzena(totals){
    var q1Ids = [], q2Ids = [], totalQ1 = 0, totalQ2 = 0, afetados = 0;
    totals.forEach(function(t){
      var afetado = false;
      if(t.quinzenas[1].adiantamentosPendentes > 0){
        q1Ids = q1Ids.concat(t.quinzenas[1].adiantamentosPendentesIds);
        totalQ1 += t.quinzenas[1].adiantamentosPendentes;
        afetado = true;
      }
      if(t.quinzenas[2].adiantamentosPendentes > 0){
        q2Ids = q2Ids.concat(t.quinzenas[2].adiantamentosPendentesIds);
        totalQ2 += t.quinzenas[2].adiantamentosPendentes;
        afetado = true;
      }
      if(afetado) afetados++;
    });
    return { q1Ids:q1Ids, q2Ids:q2Ids, totalQ1:totalQ1, totalQ2:totalQ2, afetados:afetados };
  }

  async function _handleDescontarTodosAdiantamentosPessoa(tipoPessoa, container){
    var totals = _calcFechTotals(tipoPessoa);
    var agg = _agregarIdsPendentesPorQuinzena(totals);
    if(agg.q1Ids.length === 0 && agg.q2Ids.length === 0){ _toast('Nenhum adiantamento pendente neste fechamento.'); return; }
    var totalGeralAdi = Math.round((agg.totalQ1 + agg.totalQ2) * 100) / 100;
    var plural = tipoPessoa === 'MOTORISTA' ? 'motorista(s)' : 'motoboy(s)';
    var confirmed = window.confirm('Confirmar o desconto de '+_money(totalGeralAdi)+' em adiantamentos de '+agg.afetados+' '+plural+', já separados por quinzena?\n\nEsta ação marcará todos os adiantamentos pendentes deste fechamento como Descontados.');
    if(!confirmed) return;
    if(agg.q1Ids.length > 0){
      var r1 = await _repo.marcarAdiantamentosDescontados(_companyId, agg.q1Ids, _fechMonth, _fechYear, 1);
      if(r1.error){ _toast(r1.error.userMessage || 'Erro ao descontar adiantamentos da 1ª quinzena.'); return; }
    }
    if(agg.q2Ids.length > 0){
      var r2 = await _repo.marcarAdiantamentosDescontados(_companyId, agg.q2Ids, _fechMonth, _fechYear, 2);
      if(r2.error){ _toast(r2.error.userMessage || 'Erro ao descontar adiantamentos da 2ª quinzena.'); return; }
    }
    _toast('Adiantamentos descontados com sucesso.');
    await _loadAdiantamentos();
    _rerender(container);
  }

  // Retrocompatível: mesma assinatura/comportamento de antes da generalização.
  async function _handleDescontarTodosAdiantamentos(container){
    return _handleDescontarTodosAdiantamentosPessoa('MOTOBOY', container);
  }

  // ─── Motoboys (cadastro completo — telefone / CPF / PIX / status) ────────

  function _renderMotoboys(){
    var active = _motoboys.filter(function(m){ return m.status === 'Ativo'; });
    var inactive = _motoboys.filter(function(m){ return m.status === 'Inativo'; });
    var h = '<div class="mb-section">';
    h += '<div class="mb-section-header"><h3>Motoboys Cadastrados</h3>';
    if(_canManage) h += '<button class="mb-btn-primary" id="mb-novo-motoboy">+ Novo Motoboy</button>';
    h += '</div>';
    if(_editingMotoboy !== null) h += _renderMotoboyForm();
    if(active.length === 0 && !_editingMotoboy){
      h += '<div class="mb-empty">Nenhum motoboy cadastrado ainda.</div>';
    } else {
      h += '<div class="mb-list">';
      active.forEach(function(m){ h += _renderMotoboyCard(m); });
      h += '</div>';
    }
    if(inactive.length > 0){
      h += '<div class="mb-inactive-toggle">';
      h += '<button class="mb-toggle-btn" id="mb-toggle-inactive-mb">'+(_showInactiveMotoboys?'▾':'▸')+' Inativos ('+inactive.length+')</button>';
      if(_showInactiveMotoboys){
        h += '<div class="mb-list mb-inactive-list">';
        inactive.forEach(function(m){ h += _renderMotoboyCard(m, true); });
        h += '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderMotoboyCard(m, isInactive){
    var mbRates = _rates.filter(function(r){ return r.motoboy_id === m.id; });
    var mlRate = mbRates.find(function(r){ return r.transportadora === 'MERCADO LIVRE'; });
    var shRate = mbRates.find(function(r){ return r.transportadora === 'SHOPEE'; });

    var h = '<div class="mb-card'+(isInactive?' mb-card-inactive':'')+'">';
    h += '<div class="mb-card-top">';
    h += '  <div class="mb-card-name">'+_escapeHTML(m.nome)+'</div>';
    h += '  <div class="mb-card-status '+(m.status==='Ativo'?'ativo':'inativo')+'">'+m.status+'</div>';
    h += '</div>';
    if(m.telefone) h += '<div class="mb-card-info">Tel: '+_escapeHTML(m.telefone)+'</div>';
    if(m.pix) h += '<div class="mb-card-info">PIX: '+_escapeHTML(m.pix)+'</div>';

    // Tabela de tarifas ML / Shopee diretamente no card (editável inline)
    h += '<div class="mb-rates-table">';
    h += '<div class="mb-rates-table-title">Tarifas por Pacote</div>';

    // Mercado Livre
    h += '<div class="mb-rate-row-inline">';
    h += '  <span class="mb-rate-label-ml">Mercado Livre</span>';
    if(_canManage){
      h += '  <input type="number" class="mb-input mb-rate-input"';
      h += '    data-mb-rate-motoboy="'+_escapeAttr(m.id)+'" data-mb-rate-mk="MERCADO LIVRE"';
      h += '    min="0" step="0.01" inputmode="decimal"';
      h += '    value="'+_escapeAttr(mlRate ? String(mlRate.valor_pacote) : '')+'"/>';
      h += '  <span class="mb-rate-unit">/pct</span>';
      h += '  <button class="mb-btn-sm mb-btn-save-rate"';
      h += '    data-mb-save-rate-motoboy="'+_escapeAttr(m.id)+'" data-mb-save-rate-mk="MERCADO LIVRE">Salvar</button>';
    } else {
      h += '  <span class="mb-rate-val-ro">'+(mlRate ? _money(mlRate.valor_pacote)+'/pct' : '—')+'</span>';
    }
    h += '</div>';

    // Shopee
    h += '<div class="mb-rate-row-inline">';
    h += '  <span class="mb-rate-label-sh">Shopee</span>';
    if(_canManage){
      h += '  <input type="number" class="mb-input mb-rate-input"';
      h += '    data-mb-rate-motoboy="'+_escapeAttr(m.id)+'" data-mb-rate-mk="SHOPEE"';
      h += '    min="0" step="0.01" inputmode="decimal"';
      h += '    value="'+_escapeAttr(shRate ? String(shRate.valor_pacote) : '')+'"/>';
      h += '  <span class="mb-rate-unit">/pct</span>';
      h += '  <button class="mb-btn-sm mb-btn-save-rate"';
      h += '    data-mb-save-rate-motoboy="'+_escapeAttr(m.id)+'" data-mb-save-rate-mk="SHOPEE">Salvar</button>';
    } else {
      h += '  <span class="mb-rate-val-ro">'+(shRate ? _money(shRate.valor_pacote)+'/pct' : '—')+'</span>';
    }
    h += '</div>';
    h += '</div>'; // mb-rates-table

    if(_canManage){
      h += '<div class="mb-card-actions">';
      h += '<button class="mb-btn-sm" data-mb-edit-motoboy="'+_escapeAttr(m.id)+'">Editar</button>';
      if(m.status === 'Ativo'){
        h += '<button class="mb-btn-sm danger" data-mb-deactivate-motoboy="'+_escapeAttr(m.id)+'">Desativar</button>';
      } else {
        h += '<button class="mb-btn-sm" data-mb-activate-motoboy="'+_escapeAttr(m.id)+'">Reativar</button>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderMotoboyForm(){
    var isEdit = _editingMotoboy && _editingMotoboy.id;
    var d = _editingMotoboy || {};
    var h = '<div class="mb-form-card">';
    h += '<h4>'+(isEdit?'Editar Motoboy':'Novo Motoboy')+'</h4>';
    h += '<div class="mb-form-grid">';
    h += '<div class="mb-form-field mb-full-width"><label>Nome *</label><input type="text" id="mb-mf-nome" class="mb-input" value="'+_escapeAttr(d.nome||'')+'" placeholder="Nome completo" autocomplete="off"/></div>';
    h += '<div class="mb-form-field"><label>Telefone</label><input type="tel" id="mb-mf-tel" class="mb-input" value="'+_escapeAttr(d.telefone||'')+'" placeholder="(00) 00000-0000"/></div>';
    h += '<div class="mb-form-field"><label>CPF (opcional)</label><input type="text" id="mb-mf-cpf" class="mb-input" value="'+_escapeAttr(d.cpf||'')+'" placeholder="000.000.000-00"/></div>';
    h += '<div class="mb-form-field mb-full-width"><label>PIX</label><input type="text" id="mb-mf-pix" class="mb-input" value="'+_escapeAttr(d.pix||'')+'" placeholder="Chave PIX"/></div>';
    if(isEdit){
      h += '<div class="mb-form-field"><label>Status</label><select id="mb-mf-status" class="mb-input"><option value="Ativo"'+(d.status==='Ativo'?' selected':'')+'>Ativo</option><option value="Inativo"'+(d.status==='Inativo'?' selected':'')+'>Inativo</option></select></div>';
    }
    h += '</div>';
    h += '<div class="mb-form-actions">';
    h += '<button class="mb-btn-primary" id="mb-save-motoboy">'+(isEdit?'Salvar':'Cadastrar')+'</button>';
    h += '<button class="mb-btn-ghost" id="mb-cancel-motoboy">Cancelar</button>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  // ─── Motoristas ───────────────────────────────────────────────────────────

  function _renderMotoristas(){
    var active = _motoristas.filter(function(m){ return m.status === 'Ativo'; });
    var inactive = _motoristas.filter(function(m){ return m.status === 'Inativo'; });
    var h = '<div class="mb-section">';
    h += '<div class="mb-section-header"><h3>Motoristas Cadastrados</h3>';
    if(_canManage) h += '<button class="mb-btn-primary" id="mb-novo-motorista">+ Novo Motorista</button>';
    h += '</div>';
    h += '<div class="mb-info-banner">ℹ️ Motoristas realizam a <b>coleta nas transportadoras</b> e recebem <b>diária fixa</b>. Não entregam pacotes.</div>';
    if(_editingMotorista !== null) h += _renderMotoristaForm();
    if(active.length === 0 && !_editingMotorista){
      h += '<div class="mb-empty">Nenhum motorista cadastrado ainda.</div>';
    } else {
      h += '<div class="mb-list">';
      active.forEach(function(m){ h += _renderMotoristaCard(m); });
      h += '</div>';
    }
    if(inactive.length > 0){
      h += '<div class="mb-inactive-toggle">';
      h += '<button class="mb-toggle-btn" id="mb-toggle-inactive-mot">'+(_showInactiveMotoristas?'▾':'▸')+' Inativos ('+inactive.length+')</button>';
      if(_showInactiveMotoristas){
        h += '<div class="mb-list mb-inactive-list">';
        inactive.forEach(function(m){ h += _renderMotoristaCard(m, true); });
        h += '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderMotoristaCard(m, isInactive){
    var h = '<div class="mb-card'+(isInactive?' mb-card-inactive':'')+'">';
    h += '<div class="mb-card-top">';
    h += '  <div class="mb-card-name">'+_escapeHTML(m.nome)+'</div>';
    h += '  <div class="mb-card-status '+(m.status==='Ativo'?'ativo':'inativo')+'">'+m.status+'</div>';
    h += '</div>';
    h += '<div class="mb-card-info">Diária: <b>'+_money(m.valor_diaria)+'</b></div>';
    if(m.telefone) h += '<div class="mb-card-info">Tel: '+_escapeHTML(m.telefone)+'</div>';
    if(_canManage){
      h += '<div class="mb-card-actions">';
      h += '<button class="mb-btn-sm" data-mb-edit-motorista="'+_escapeAttr(m.id)+'">Editar</button>';
      if(m.status === 'Ativo'){
        h += '<button class="mb-btn-sm danger" data-mb-deactivate-motorista="'+_escapeAttr(m.id)+'">Desativar</button>';
      } else {
        h += '<button class="mb-btn-sm" data-mb-activate-motorista="'+_escapeAttr(m.id)+'">Reativar</button>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderMotoristaForm(){
    var isEdit = _editingMotorista && _editingMotorista.id;
    var d = _editingMotorista || {};
    var h = '<div class="mb-form-card">';
    h += '<h4>'+(isEdit?'Editar Motorista':'Novo Motorista')+'</h4>';
    h += '<div class="mb-form-grid">';
    h += '<div class="mb-form-field mb-full-width"><label>Nome *</label><input type="text" id="mb-mot-nome" class="mb-input" value="'+_escapeAttr(d.nome||'')+'" placeholder="Nome completo" autocomplete="off"/></div>';
    h += '<div class="mb-form-field"><label>Telefone</label><input type="tel" id="mb-mot-tel" class="mb-input" value="'+_escapeAttr(d.telefone||'')+'" placeholder="(00) 00000-0000"/></div>';
    h += '<div class="mb-form-field"><label>Diária (R$) *</label><input type="number" id="mb-mot-diaria" class="mb-input" min="0" step="0.01" inputmode="decimal" value="'+_escapeAttr(d.valor_diaria!=null?d.valor_diaria:70)+'"/></div>';
    if(isEdit){
      h += '<div class="mb-form-field"><label>Status</label><select id="mb-mot-status" class="mb-input"><option value="Ativo"'+(d.status==='Ativo'?' selected':'')+'>Ativo</option><option value="Inativo"'+(d.status==='Inativo'?' selected':'')+'>Inativo</option></select></div>';
    }
    h += '</div>';
    h += '<div class="mb-form-actions">';
    h += '<button class="mb-btn-primary" id="mb-save-motorista">'+(isEdit?'Salvar':'Cadastrar')+'</button>';
    h += '<button class="mb-btn-ghost" id="mb-cancel-motorista">Cancelar</button>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  function _renderDashboard(){
    var totals = _calcTotaisEntries(_entries);
    var h = '<div class="mb-section">';
    h += '<div class="mb-section-header"><h3>Dashboard — Motoboys & Motoristas</h3></div>';
    h += _renderPeriodFilters();

    // KPIs com a regra oficial de Lucro Líquido
    h += '<div class="mb-kpi-grid">';
    h += _kpi('Receita Transportadoras', _money(totals.receitaTransportadoras), 'pos');
    h += _kpi('Pago Motoboys', _money(totals.totalMotoboys), 'neg');
    h += _kpi('Diárias Motoristas', _money(totals.totalDiarias), 'neg');
    h += _kpi('Lucro Líquido', _money(totals.lucroLiquido), totals.lucroLiquido>=0?'pos':'neg');
    h += _kpi('Total Pacotes', String(totals.totalPacotes), '');
    h += _kpi('Total Entregas', String(totals.totalEntregas), '');
    h += '</div>';

    // Fórmula visual da regra oficial
    h += '<div class="mb-formula-card">';
    h += '<div class="mb-formula-title">Fórmula Oficial — Lucro Líquido</div>';
    h += '<div class="mb-formula-eq">';
    h += '<span class="mb-formula-item pos"><span class="mb-formula-num">'+_money(totals.receitaTransportadoras)+'</span><span class="mb-formula-lbl">Receita</span></span>';
    h += '<span class="mb-formula-op">−</span>';
    h += '<span class="mb-formula-item neg"><span class="mb-formula-num">'+_money(totals.totalMotoboys)+'</span><span class="mb-formula-lbl">Motoboys</span></span>';
    h += '<span class="mb-formula-op">−</span>';
    h += '<span class="mb-formula-item neg"><span class="mb-formula-num">'+_money(totals.totalDiarias)+'</span><span class="mb-formula-lbl">Motoristas</span></span>';
    h += '<span class="mb-formula-op">=</span>';
    h += '<span class="mb-formula-item '+(totals.lucroLiquido>=0?'pos':'neg')+'"><span class="mb-formula-num">'+_money(totals.lucroLiquido)+'</span><span class="mb-formula-lbl">Lucro</span></span>';
    h += '</div>';
    h += '</div>';

    // Adiantamentos do período (Total de Adiantamentos / Total Descontado / Pagamento Líquido)
    h += _renderAdiantamentosTotalsBar(totals.totalMotoboys);

    // Ranking de motoboys por valor pago
    var mbTotals = {};
    _entries.forEach(function(e){
      var id = e.motoboy_id;
      if(!mbTotals[id]) mbTotals[id] = { nome: e.motoboys ? e.motoboys.nome : id, pacotes:0, motoboy:0, entregas:0 };
      mbTotals[id].pacotes += parseInt(e.quantidade_pacotes,10)||0;
      mbTotals[id].motoboy += parseFloat(e.valor_motoboy)||0;
      mbTotals[id].entregas++;
    });
    var mbList = Object.values(mbTotals).sort(function(a,b){ return b.motoboy - a.motoboy; });

    if(mbList.length > 0){
      h += '<div class="mb-ranking">';
      h += '<h4 class="mb-rank-title">Ranking por Motoboy — Total Pago</h4>';
      mbList.forEach(function(mb, i){
        h += '<div class="mb-rank-row">';
        h += '<span class="mb-rank-num">'+(i+1)+'</span>';
        h += '<span class="mb-rank-name">'+_escapeHTML(mb.nome)+'</span>';
        h += '<span class="mb-rank-info">'+mb.pacotes+' pcts · '+mb.entregas+' entregas</span>';
        h += '<span class="mb-rank-val neg">'+_money(mb.motoboy)+'</span>';
        h += '</div>';
      });
      h += '</div>';
    }

    // Ranking por marketplace
    var mkTotals = {};
    _entries.forEach(function(e){
      var t = e.transportadora;
      if(!mkTotals[t]) mkTotals[t] = { pacotes:0, motoboy:0, entregas:0 };
      mkTotals[t].pacotes += parseInt(e.quantidade_pacotes,10)||0;
      mkTotals[t].motoboy += parseFloat(e.valor_motoboy)||0;
      mkTotals[t].entregas++;
    });
    var mkList = Object.entries(mkTotals).sort(function(a,b){ return b[1].pacotes - a[1].pacotes; });

    if(mkList.length > 0){
      h += '<div class="mb-ranking">';
      h += '<h4 class="mb-rank-title">Ranking por Marketplace</h4>';
      mkList.forEach(function(pair, i){
        var tr = pair[0], d = pair[1];
        h += '<div class="mb-rank-row">';
        h += '<span class="mb-rank-num">'+(i+1)+'</span>';
        h += '<span class="mb-rank-name">'+_escapeHTML(tr)+'</span>';
        h += '<span class="mb-rank-info">'+d.pacotes+' pcts · '+d.entregas+' entregas</span>';
        h += '<span class="mb-rank-val neg">'+_money(d.motoboy)+'</span>';
        h += '</div>';
      });
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  function _kpi(label, value, cls){
    return '<div class="mb-kpi-card"><div class="mb-kpi-label">'+label+'</div><div class="mb-kpi-val '+(cls||'')+'">'+value+'</div></div>';
  }

  function _renderPeriodFilters(){
    var periods = [['hoje','Hoje'],['semana','Semana'],['mes','Mês'],['ano','Ano'],['custom','Período']];
    var h = '<div class="mb-filters"><div class="mb-period-tabs">';
    periods.forEach(function(p){
      h += '<button class="mb-ptab'+(_filterPeriod===p[0]?' active':'')+'" data-mb-period="'+p[0]+'">'+p[1]+'</button>';
    });
    h += '</div>';
    if(_filterPeriod === 'custom'){
      h += '<div class="mb-date-range">';
      h += '<input type="date" class="mb-input-date" id="mb-filter-from" value="'+_escapeAttr(_filterFrom)+'"/>';
      h += '<span class="mb-range-sep">até</span>';
      h += '<input type="date" class="mb-input-date" id="mb-filter-to" value="'+_escapeAttr(_filterTo)+'"/>';
      h += '<button class="mb-btn-sm" id="mb-apply-dates">Aplicar</button>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderEntryTotalsBar(totals){
    var h = '<div class="mb-totals-bar mb-totals-5">';
    h += '<div class="mb-total-item"><span class="mb-tlabel">Receita Transportadoras</span><span class="mb-tval pos">'+_money(totals.receitaTransportadoras)+'</span></div>';
    h += '<div class="mb-total-item"><span class="mb-tlabel">Pago Motoboys</span><span class="mb-tval neg">'+_money(totals.totalMotoboys)+'</span></div>';
    h += '<div class="mb-total-item"><span class="mb-tlabel">Diárias Motoristas</span><span class="mb-tval neg">'+_money(totals.totalDiarias)+'</span></div>';
    h += '<div class="mb-total-item mb-total-highlight"><span class="mb-tlabel">Lucro Líquido</span><span class="mb-tval '+(totals.lucroLiquido>=0?'pos':'neg')+'">'+_money(totals.lucroLiquido)+'</span></div>';
    h += '<div class="mb-total-item"><span class="mb-tlabel">Pacotes</span><span class="mb-tval">'+totals.totalPacotes+'</span></div>';
    h += '</div>';
    return h;
  }

  // Barra de totais dos Adiantamentos para o período filtrado (Dashboard/Relatórios).
  // "Pagamento Líquido (período)" = Pago Motoboys do período (totals.totalMotoboys,
  // já calculado por _calcTotaisEntries — não duplicado aqui) menos os
  // Adiantamentos ainda Pendentes datados dentro do período filtrado. Reutiliza o
  // estilo padrão de 3 colunas de .mb-totals-bar (sem precisar de CSS novo).
  function _renderAdiantamentosTotalsBar(totalMotoboysPeriodo){
    var adiTotais = _repo.calcAdiantamentosTotais(_periodAdiantamentos);
    var liquido = Math.round((totalMotoboysPeriodo - adiTotais.totalPendente) * 100) / 100;
    var h = '<div class="mb-totals-bar">';
    h += '<div class="mb-total-item"><span class="mb-tlabel">Total de Adiantamentos</span><span class="mb-tval neg">'+_money(adiTotais.totalGeral)+'</span></div>';
    h += '<div class="mb-total-item"><span class="mb-tlabel">Total Descontado</span><span class="mb-tval pos">'+_money(adiTotais.totalDescontado)+'</span></div>';
    h += '<div class="mb-total-item mb-total-highlight"><span class="mb-tlabel">Pagamento Líquido</span><span class="mb-tval '+(liquido>=0?'pos':'neg')+'">'+_money(liquido)+'</span></div>';
    h += '</div>';
    return h;
  }

  // ─── Relatórios ───────────────────────────────────────────────────────────

  function _renderRelatorios(){
    var h = '<div class="mb-section">';
    h += '<div class="mb-section-header"><h3>Relatórios — Motoboys</h3></div>';
    h += _renderPeriodFilters();
    h += '<div class="mb-extra-filters">';
    h += '<select class="mb-input mb-filter-sel" id="mb-rel-motoboy"><option value="">Todos os motoboys</option>';
    _motoboys.forEach(function(m){ h += '<option value="'+_escapeAttr(m.id)+'"'+(m.id===_filterMotoboy?' selected':'')+'>'+_escapeHTML(m.nome)+'</option>'; });
    h += '</select>';
    h += '<select class="mb-input mb-filter-sel" id="mb-rel-motorista"><option value="">Todos os motoristas</option>';
    _motoristas.forEach(function(m){ h += '<option value="'+_escapeAttr(m.id)+'"'+(m.id===_filterMotorista?' selected':'')+'>'+_escapeHTML(m.nome)+'</option>'; });
    h += '</select>';
    h += '<button class="mb-btn-sm" id="mb-apply-rel-filters">Filtrar</button>';
    h += '</div>';

    if(_entries.length === 0){
      h += '<div class="mb-empty">Nenhum lançamento para os filtros selecionados.</div>';
    } else {
      var totals = _calcTotaisEntries(_entries);
      h += _renderEntryTotalsBar(totals);
      h += _renderAdiantamentosTotalsBar(totals.totalMotoboys);
      h += '<div class="mb-table-wrap">';
      h += '<table class="mb-table">';
      h += '<thead><tr><th>Data</th><th>Marketplace</th><th>Motoboy</th><th>Motorista</th><th>Diária Motorista</th><th>Pacotes</th><th>Pago Motoboy</th></tr></thead>';
      h += '<tbody>';
      // A diária do motorista é contabilizada UMA ÚNICA VEZ por motorista por dia
      // (mesma regra de _repo.calcTotalDiarias). Aqui marcamos, linha a linha, em
      // qual lançamento a diária efetivamente entra no total, para o valor exibido
      // na tabela bater exatamente com o KPI "Diárias Motoristas" acima.
      var seenDiaria = {};
      _entries.forEach(function(e){
        h += '<tr>';
        h += '<td>'+_brDate(e.date_key)+'</td>';
        h += '<td>'+_escapeHTML(e.transportadora)+'</td>';
        h += '<td>'+_escapeHTML(e.motoboys ? e.motoboys.nome : '—')+'</td>';
        h += '<td>'+_escapeHTML(e.motoristas ? e.motoristas.nome : '—')+'</td>';
        if(e.motorista_id){
          var diariaKey = e.date_key + ':' + e.motorista_id;
          var valorDiaria = e.motoristas ? (parseFloat(e.motoristas.valor_diaria) || 0) : 0;
          if(!seenDiaria[diariaKey]){
            seenDiaria[diariaKey] = true;
            h += '<td class="num neg">'+_money(valorDiaria)+'</td>';
          } else {
            h += '<td class="num mb-diaria-dup" title="Diária já contabilizada neste dia para este motorista">já contada</td>';
          }
        } else {
          h += '<td class="num">—</td>';
        }
        h += '<td class="num">'+_escapeHTML(String(e.quantidade_pacotes))+'</td>';
        h += '<td class="num neg">'+_money(e.valor_motoboy)+'</td>';
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }

  // ─── Bind de eventos ──────────────────────────────────────────────────────

  function bindEvents(container){
    if(!container) return;

    // Sub-tabs
    container.querySelectorAll('[data-mb-tab]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        _subTab = btn.getAttribute('data-mb-tab');
        _editingMotoboy = null;
        _editingMotorista = null;
        _showAddAdiantamento = false;
        _editingAdiantamento = null;
        if(_subTab === 'lancamentos'){
          await _loadDayEntries();
          await _loadMonthEntries();
        } else if(_subTab === 'adiantamentos'){
          await _loadAdiantamentos();
        } else if(_subTab === 'fechamento'){
          await _loadFechEntries();
          await _loadAdiantamentos();
        } else if(_subTab === 'dashboard' || _subTab === 'relatorios'){
          await _loadEntries();
        }
        _rerender(container);
      });
    });

    // Filtros de período (Dashboard / Relatórios)
    container.querySelectorAll('[data-mb-period]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        _filterPeriod = btn.getAttribute('data-mb-period');
        if(_filterPeriod !== 'custom'){
          await _loadEntries();
          _rerender(container);
        } else {
          _rerender(container);
        }
      });
    });

    var applyDates = container.querySelector('#mb-apply-dates');
    if(applyDates){
      applyDates.addEventListener('click', async function(){
        var fromEl = container.querySelector('#mb-filter-from');
        var toEl = container.querySelector('#mb-filter-to');
        _filterFrom = fromEl ? fromEl.value : '';
        _filterTo = toEl ? toEl.value : '';
        await _loadEntries();
        _rerender(container);
      });
    }

    // ── Lançamentos — calendário ──────────────────────────────────────────

    container.querySelectorAll('[data-mb-lanc-date]').forEach(function(cell){
      cell.addEventListener('click', async function(){
        var key = cell.getAttribute('data-mb-lanc-date');
        if(!key || key === _lancDate) return;
        _lancDate = key;
        await _loadDayEntries();
        _rerender(container);
      });
    });

    container.querySelectorAll('[data-mb-cal-nav]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var dir = parseInt(btn.getAttribute('data-mb-cal-nav'), 10);
        _lancCalMonth += dir;
        if(_lancCalMonth < 1){ _lancCalMonth = 12; _lancCalYear--; }
        if(_lancCalMonth > 12){ _lancCalMonth = 1; _lancCalYear++; }
        await _loadMonthEntries();
        _rerender(container);
      });
    });

    // ── Fechamento — navegação de mês, expandir motoboy, gerar PDFs ───────

    container.querySelectorAll('[data-mb-fech-nav]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var dir = parseInt(btn.getAttribute('data-mb-fech-nav'), 10);
        _fechMonth += dir;
        if(_fechMonth < 1){ _fechMonth = 12; _fechYear--; }
        if(_fechMonth > 12){ _fechMonth = 1; _fechYear++; }
        _expandedFechMotoboy = null;
        await _loadFechEntries();
        _rerender(container);
      });
    });

    container.querySelectorAll('.fech-row[data-mb-fech-toggle]').forEach(function(row){
      row.addEventListener('click', function(){
        var id = row.getAttribute('data-mb-fech-toggle');
        _expandedFechMotoboy = (_expandedFechMotoboy === id) ? null : id;
        _rerender(container);
      });
    });

    container.querySelectorAll('.fech-gen-pdf-btn[data-mb-fech-pdf]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        _generateMotoboyPDF(btn.getAttribute('data-mb-fech-pdf'));
      });
    });

    var genPdfGeral = container.querySelector('#mb-gen-pdf-geral');
    if(genPdfGeral) genPdfGeral.addEventListener('click', function(){ _generateFechGeralPDF(); });

    var genCsvFechamento = container.querySelector('#mb-gen-csv-fechamento');
    if(genCsvFechamento) genCsvFechamento.addEventListener('click', function(){ _generateFechamentoCSV(); });

    var descontarTodosAdi = container.querySelector('#mb-descontar-todos-adi');
    if(descontarTodosAdi) descontarTodosAdi.addEventListener('click', async function(){ await _handleDescontarTodosAdiantamentos(container); });

    var descontarTodosAdiMotorista = container.querySelector('#mb-descontar-todos-adi-motorista');
    if(descontarTodosAdiMotorista) descontarTodosAdiMotorista.addEventListener('click', async function(){ await _handleDescontarTodosAdiantamentosPessoa('MOTORISTA', container); });

    container.querySelectorAll('[data-mb-descontar-adi-qz]').forEach(function(btn){
      btn.addEventListener('click', async function(e){
        e.stopPropagation();
        var pessoaId = btn.getAttribute('data-mb-descontar-adi-qz');
        var which = btn.getAttribute('data-mb-qz');
        var tipoPessoa = btn.getAttribute('data-mb-tipo-pessoa') || 'MOTOBOY';
        await _handleDescontarAdiantamentosPessoaQuinzena(tipoPessoa, pessoaId, which, container);
      });
    });

    // ── Adiantamentos (Vales) — form, filtros e ações ──────────────────────

    container.querySelectorAll('[data-mb-adi-tipo]').forEach(function(btn){
      btn.addEventListener('click', function(){
        _adiTipoPessoa = btn.getAttribute('data-mb-adi-tipo') === 'MOTORISTA' ? 'MOTORISTA' : 'MOTOBOY';
        _adiFilterPessoa = '';
        _showAddAdiantamento = false;
        _editingAdiantamento = null;
        _rerender(container);
      });
    });

    var novoAdiantamentoBtn = container.querySelector('#mb-novo-adiantamento');
    if(novoAdiantamentoBtn){
      novoAdiantamentoBtn.addEventListener('click', function(){
        _showAddAdiantamento = true;
        _editingAdiantamento = null;
        _rerender(container);
      });
    }

    var saveAdiantamentoBtn = container.querySelector('#mb-save-adiantamento');
    if(saveAdiantamentoBtn){
      saveAdiantamentoBtn.addEventListener('click', async function(){ await _handleSaveAdiantamento(container); });
    }

    var cancelAdiantamentoBtn = container.querySelector('#mb-cancel-adiantamento');
    if(cancelAdiantamentoBtn){
      cancelAdiantamentoBtn.addEventListener('click', function(){
        _showAddAdiantamento = false;
        _editingAdiantamento = null;
        _rerender(container);
      });
    }

    container.querySelectorAll('[data-mb-edit-adiantamento]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-mb-edit-adiantamento');
        var found = _adiantamentos.find(function(a){ return a.id === id; });
        if(!found) return;
        _editingAdiantamento = found;
        _showAddAdiantamento = false;
        _rerender(container);
      });
    });

    container.querySelectorAll('[data-mb-delete-adiantamento]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        await _handleDeleteAdiantamento(btn.getAttribute('data-mb-delete-adiantamento'), container);
      });
    });

    var adiApplyFilters = container.querySelector('#mb-adi-apply-filters');
    if(adiApplyFilters){
      adiApplyFilters.addEventListener('click', function(){
        _adiFilterPessoa = (container.querySelector('#mb-adi-filter-pessoa') || {}).value || '';
        _adiFilterStatus = (container.querySelector('#mb-adi-filter-status') || {}).value || '';
        _adiFilterFrom = (container.querySelector('#mb-adi-filter-from') || {}).value || '';
        _adiFilterTo = (container.querySelector('#mb-adi-filter-to') || {}).value || '';
        _rerender(container);
      });
    }

    var adiClearFilters = container.querySelector('#mb-adi-clear-filters');
    if(adiClearFilters){
      adiClearFilters.addEventListener('click', function(){
        _adiFilterPessoa = '';
        _adiFilterStatus = '';
        _adiFilterFrom = '';
        _adiFilterTo = '';
        _rerender(container);
      });
    }

    // ── Lançamentos — motorista da diária ─────────────────────────────────

    var dayMotSel = container.querySelector('#mb-day-motorista');
    if(dayMotSel){
      dayMotSel.addEventListener('change', async function(){
        _dayMotoristaId = dayMotSel.value || '';
        for(var i = 0; i < _dayEntries.length; i++){
          _dayEntries[i].motorista_id = _dayMotoristaId || null;
          await _persistDayEntry(_dayEntries[i].motoboy_id, _dayEntries[i].transportadora);
        }
        _toast('Motorista da diária atualizado.');
        _rerender(container);
      });
    }

    // ── Lançamentos — busca de motoboy ────────────────────────────────────

    var lancSearch = container.querySelector('#mb-lanc-search');
    if(lancSearch){
      lancSearch.addEventListener('input', function(){
        _lancSearch = lancSearch.value;
        _rerender(container);
        var again = container.querySelector('#mb-lanc-search');
        if(again){ again.focus(); var val = again.value; again.value=''; again.value = val; }
      });
    }

    // ── Lançamentos — adicionar motoboy inline ────────────────────────────

    var toggleAddMb = container.querySelector('#mb-toggle-add-motoboy');
    if(toggleAddMb){
      toggleAddMb.addEventListener('click', function(){
        _showAddMotoboy = !_showAddMotoboy;
        _addMotoboyError = '';
        _rerender(container);
      });
    }

    var confirmAddMb = container.querySelector('#mb-confirm-add-motoboy');
    if(confirmAddMb){
      confirmAddMb.addEventListener('click', async function(){ await _handleQuickAddMotoboy(container); });
    }

    // ── Lançamentos — remover / reativar motoboy direto da lista ─────────

    container.querySelectorAll('[data-mb-remove-motoboy]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var id = btn.getAttribute('data-mb-remove-motoboy');
        var m = _motoboys.find(function(x){ return x.id === id; });
        if(!m) return;
        var confirmed = window.confirm('Encerrar a parceria com "'+m.nome+'"?\n\nEle deixará de aparecer para novos lançamentos, mas os lançamentos e relatórios já registrados serão mantidos. É possível reativá-lo depois.');
        if(!confirmed) return;
        var result = await _repo.upsertMotoboy(Object.assign({}, m, { status:'Inativo' }));
        if(result.error){ _toast(result.error.userMessage || 'Erro.'); return; }
        _toast('Motoboy removido da lista de lançamentos.');
        await _loadAll();
        _rerender(container);
      });
    });

    container.querySelectorAll('[data-mb-reactivate-motoboy]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var id = btn.getAttribute('data-mb-reactivate-motoboy');
        var m = _motoboys.find(function(x){ return x.id === id; });
        if(!m) return;
        var result = await _repo.upsertMotoboy(Object.assign({}, m, { status:'Ativo' }));
        if(result.error){ _toast(result.error.userMessage || 'Erro.'); return; }
        _toast('Motoboy reativado.');
        await _loadAll();
        _rerender(container);
      });
    });

    var toggleInactiveLanc = container.querySelector('#mb-toggle-inactive-lanc');
    if(toggleInactiveLanc) toggleInactiveLanc.addEventListener('click', function(){ _showInactiveLanc = !_showInactiveLanc; _rerender(container); });

    // ── Lançamentos — quantidades ML / SH (atualização instantânea) ──────

    container.querySelectorAll('[data-mb-lanc-qtd]').forEach(function(inp){
      inp.addEventListener('input', function(){
        var motoboyId = inp.getAttribute('data-mb-lanc-qtd');
        var transp = inp.getAttribute('data-mb-lanc-mk');
        var qtd = inp.value === '' ? 0 : Math.max(0, parseInt(inp.value, 10) || 0);
        _setDayQty(motoboyId, transp, qtd);

        var d = _getMotoboyDayData(motoboyId);
        var total = Math.round(((d.mlVal||0) + (d.shVal||0)) * 100) / 100;
        var row = container.querySelector('[data-mb-lanc-row="'+motoboyId+'"]');
        if(row){ var rv = row.querySelector('.row-value b'); if(rv) rv.textContent = _money(total); }

        _refreshLancFooterDOM(container);

        var cell = container.querySelector('.cal-cell[data-mb-lanc-date="'+_lancDate+'"]');
        if(cell && !cell.querySelector('.cdot') && ((d.mlQtd||0) > 0 || (d.shQtd||0) > 0)){
          var dot = document.createElement('span'); dot.className = 'cdot'; cell.appendChild(dot);
        }

        _scheduleDaySave(motoboyId, transp);
      });
    });

    // ── Motoboys (cadastro completo) ──────────────────────────────────────

    var novoMb = container.querySelector('#mb-novo-motoboy');
    if(novoMb) novoMb.addEventListener('click', function(){ _editingMotoboy = {}; _rerender(container); });

    var saveMb = container.querySelector('#mb-save-motoboy');
    if(saveMb) saveMb.addEventListener('click', async function(){ await _handleSaveMotoboy(container); });

    var cancelMb = container.querySelector('#mb-cancel-motoboy');
    if(cancelMb) cancelMb.addEventListener('click', function(){ _editingMotoboy = null; _rerender(container); });

    container.querySelectorAll('[data-mb-edit-motoboy]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-mb-edit-motoboy');
        _editingMotoboy = _motoboys.find(function(m){ return m.id === id; }) || {};
        _rerender(container);
      });
    });

    container.querySelectorAll('[data-mb-deactivate-motoboy]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var id = btn.getAttribute('data-mb-deactivate-motoboy');
        var m = _motoboys.find(function(x){ return x.id === id; });
        if(!m) return;
        var result = await _repo.upsertMotoboy(Object.assign({}, m, { status:'Inativo' }));
        if(result.error){ _toast(result.error.userMessage || 'Erro.'); return; }
        _toast('Motoboy desativado.');
        await _loadAll();
        _rerender(container);
      });
    });

    container.querySelectorAll('[data-mb-activate-motoboy]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var id = btn.getAttribute('data-mb-activate-motoboy');
        var m = _motoboys.find(function(x){ return x.id === id; });
        if(!m) return;
        var result = await _repo.upsertMotoboy(Object.assign({}, m, { status:'Ativo' }));
        if(result.error){ _toast(result.error.userMessage || 'Erro.'); return; }
        _toast('Motoboy reativado.');
        await _loadAll();
        _rerender(container);
      });
    });

    // Salvar tarifa inline (ML / Shopee) diretamente no card do motoboy
    container.querySelectorAll('[data-mb-save-rate-motoboy]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var motoboyId = btn.getAttribute('data-mb-save-rate-motoboy');
        var marketplace = btn.getAttribute('data-mb-save-rate-mk');
        var input = container.querySelector(
          'input[data-mb-rate-motoboy="'+motoboyId+'"][data-mb-rate-mk="'+marketplace+'"]'
        );
        if(!input){ _toast('Campo não encontrado.'); return; }
        var val = parseFloat(input.value);
        if(isNaN(val) || val < 0){ _toast('Valor inválido para '+marketplace+'.'); return; }
        var existingRate = _rates.find(function(r){
          return r.motoboy_id === motoboyId && r.transportadora === marketplace;
        });
        var payload = { company_id: _companyId, motoboy_id: motoboyId, transportadora: marketplace, valor_pacote: val };
        if(existingRate) payload.id = existingRate.id;
        var result = await _repo.upsertMotoboiRate(payload);
        if(result.error){ _toast(result.error.userMessage || 'Erro ao salvar tarifa.'); return; }
        _toast('Tarifa '+marketplace+' atualizada com sucesso.');
        if(existingRate){
          var idx = _rates.findIndex(function(r){ return r.id === existingRate.id; });
          if(idx !== -1) _rates[idx].valor_pacote = val;
        } else if(result.data){
          _rates.push(result.data);
        }
        _rerender(container);
      });
    });

    var toggleInactiveMb = container.querySelector('#mb-toggle-inactive-mb');
    if(toggleInactiveMb) toggleInactiveMb.addEventListener('click', function(){ _showInactiveMotoboys = !_showInactiveMotoboys; _rerender(container); });

    // ── Motoristas ─────────────────────────────────────────────────────────

    var novoMot = container.querySelector('#mb-novo-motorista');
    if(novoMot) novoMot.addEventListener('click', function(){ _editingMotorista = {}; _rerender(container); });

    var saveMot = container.querySelector('#mb-save-motorista');
    if(saveMot) saveMot.addEventListener('click', async function(){ await _handleSaveMotorista(container); });

    var cancelMot = container.querySelector('#mb-cancel-motorista');
    if(cancelMot) cancelMot.addEventListener('click', function(){ _editingMotorista = null; _rerender(container); });

    container.querySelectorAll('[data-mb-edit-motorista]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-mb-edit-motorista');
        _editingMotorista = _motoristas.find(function(m){ return m.id === id; }) || {};
        _rerender(container);
      });
    });

    container.querySelectorAll('[data-mb-deactivate-motorista]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var id = btn.getAttribute('data-mb-deactivate-motorista');
        var m = _motoristas.find(function(x){ return x.id === id; });
        if(!m) return;
        var result = await _repo.upsertMotorista(Object.assign({}, m, { status:'Inativo' }));
        if(result.error){ _toast(result.error.userMessage || 'Erro.'); return; }
        _toast('Motorista desativado.');
        await _loadAll();
        _rerender(container);
      });
    });

    container.querySelectorAll('[data-mb-activate-motorista]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var id = btn.getAttribute('data-mb-activate-motorista');
        var m = _motoristas.find(function(x){ return x.id === id; });
        if(!m) return;
        var result = await _repo.upsertMotorista(Object.assign({}, m, { status:'Ativo' }));
        if(result.error){ _toast(result.error.userMessage || 'Erro.'); return; }
        _toast('Motorista reativado.');
        await _loadAll();
        _rerender(container);
      });
    });

    var toggleInactiveMot = container.querySelector('#mb-toggle-inactive-mot');
    if(toggleInactiveMot) toggleInactiveMot.addEventListener('click', function(){ _showInactiveMotoristas = !_showInactiveMotoristas; _rerender(container); });

    // ── Relatórios ─────────────────────────────────────────────────────────

    var applyRelFilters = container.querySelector('#mb-apply-rel-filters');
    if(applyRelFilters){
      applyRelFilters.addEventListener('click', async function(){
        var mbSel = container.querySelector('#mb-rel-motoboy');
        var motSel = container.querySelector('#mb-rel-motorista');
        _filterMotoboy = mbSel ? mbSel.value : '';
        _filterMotorista = motSel ? motSel.value : '';
        await _loadEntries();
        _rerender(container);
      });
    }
  }

  function _rerender(container){
    container.innerHTML = render();
    bindEvents(container);
  }

  // ─── Lançamentos — persistência (igual ao padrão da Coleta Diária) ───────

  // Atualiza em memória a quantidade lançada de um motoboy/marketplace no dia selecionado
  // e recalcula o valor automaticamente (nunca editável manualmente)
  function _setDayQty(motoboyId, transp, qtd){
    var rate = _getRate(motoboyId, transp);
    var valor = Math.round(rate * qtd * 100) / 100;
    var e = _dayEntries.find(function(x){ return x.motoboy_id === motoboyId && x.transportadora === transp; });
    if(!e){
      e = {
        id: null,
        company_id: _companyId,
        date_key: _lancDate,
        transportadora: transp,
        motoboy_id: motoboyId,
        motorista_id: _dayMotoristaId || null,
        quantidade_pacotes: qtd,
        valor_recebido: 0,
        valor_motoboy: valor,
        observacoes: ''
      };
      _dayEntries.push(e);
    } else {
      e.quantidade_pacotes = qtd;
      e.valor_motoboy = valor;
    }
    return e;
  }

  function _scheduleDaySave(motoboyId, transp){
    var key = motoboyId + ':' + transp;
    clearTimeout(_dayFieldTimers[key]);
    _setSaveChip('sincronizando');
    _dayFieldTimers[key] = setTimeout(function(){ _persistDayEntry(motoboyId, transp); }, 450);
  }

  async function _persistDayEntry(motoboyId, transp){
    var e = _dayEntries.find(function(x){ return x.motoboy_id === motoboyId && x.transportadora === transp; });
    if(!e) return;
    var payload = {
      company_id: _companyId,
      date_key: _lancDate,
      transportadora: transp,
      motoboy_id: motoboyId,
      motorista_id: e.motorista_id || null,
      quantidade_pacotes: e.quantidade_pacotes,
      valor_recebido: 0,
      valor_motoboy: e.valor_motoboy,
      observacoes: e.observacoes || ''
    };
    if(e.id) payload.id = e.id;
    var result = await _repo.upsertEntry(payload);
    if(result.error){
      _setSaveChip('erro ao sincronizar');
      _toast(result.error.userMessage || 'Erro ao sincronizar lançamento.');
      return;
    }
    if(result.data) e.id = result.data.id;
    _setSaveChip('salvo');
    if(result.data){
      var monthIdx = _monthEntries.findIndex(function(x){ return x.id === result.data.id; });
      if(monthIdx === -1){
        _monthEntries.push(result.data);
      } else {
        _monthEntries[monthIdx] = result.data;
      }
    }
  }

  // ─── Handlers de salvamento ───────────────────────────────────────────────

  async function _handleQuickAddMotoboy(container){
    var nomeEl = container.querySelector('#mb-new-nome');
    var mlEl = container.querySelector('#mb-new-ml');
    var shEl = container.querySelector('#mb-new-sh');
    var nome = (nomeEl ? nomeEl.value : '').trim();
    if(!nome){ _addMotoboyError = 'Informe o nome do motoboy.'; _rerender(container); return; }
    var dup = _motoboys.some(function(m){ return (m.nome||'').toUpperCase() === nome.toUpperCase(); });
    if(dup){ _addMotoboyError = 'Já existe um motoboy com esse nome.'; _rerender(container); return; }

    var mlVal = parseFloat(String(mlEl ? mlEl.value : '').replace(',', '.'));
    var shVal = parseFloat(String(shEl ? shEl.value : '').replace(',', '.'));
    if(isNaN(mlVal) || mlVal < 0) mlVal = 0;
    if(isNaN(shVal) || shVal < 0) shVal = 0;

    var result = await _repo.upsertMotoboy({ company_id: _companyId, nome: nome, status: 'Ativo' });
    if(result.error){ _addMotoboyError = result.error.userMessage || 'Erro ao cadastrar motoboy.'; _rerender(container); return; }
    var mb = result.data;

    await _repo.upsertMotoboiRate({ company_id: _companyId, motoboy_id: mb.id, transportadora: 'MERCADO LIVRE', valor_pacote: mlVal });
    await _repo.upsertMotoboiRate({ company_id: _companyId, motoboy_id: mb.id, transportadora: 'SHOPEE', valor_pacote: shVal });

    await _loadAll();
    _showAddMotoboy = false;
    _addMotoboyError = '';
    _lancSearch = '';
    _toast('Motoboy "'+nome+'" adicionado.');
    _rerender(container);
  }

  async function _handleSaveMotoboy(container){
    var nome = (container.querySelector('#mb-mf-nome') || {}).value || '';
    if(!nome.trim()){ _toast('Informe o nome do motoboy.'); return; }
    var payload = {
      company_id: _companyId,
      nome: nome,
      telefone: (container.querySelector('#mb-mf-tel') || {}).value || '',
      cpf: (container.querySelector('#mb-mf-cpf') || {}).value || '',
      pix: (container.querySelector('#mb-mf-pix') || {}).value || '',
      status: ((container.querySelector('#mb-mf-status') || {}).value) || 'Ativo'
    };
    if(_editingMotoboy && _editingMotoboy.id) payload.id = _editingMotoboy.id;
    var result = await _repo.upsertMotoboy(payload);
    if(result.error){ _toast(result.error.userMessage || 'Erro ao salvar.'); return; }
    _toast(_editingMotoboy && _editingMotoboy.id ? 'Motoboy atualizado.' : 'Motoboy cadastrado.');
    var isNew = !(_editingMotoboy && _editingMotoboy.id);
    _editingMotoboy = null;
    await _loadAll();

    // Para novo motoboy: cria tarifas padrão ML/SH
    if(isNew && result.data){
      var nomeUpper = (result.data.nome || '').toUpperCase();
      var defaultRates = DEFAULT_MOTOBOY_RATES[nomeUpper];
      var mlVal = defaultRates ? defaultRates.ml : 0;
      var shVal = defaultRates ? defaultRates.sh : 0;
      await _repo.upsertMotoboiRate({ company_id: _companyId, motoboy_id: result.data.id, transportadora: 'MERCADO LIVRE', valor_pacote: mlVal });
      await _repo.upsertMotoboiRate({ company_id: _companyId, motoboy_id: result.data.id, transportadora: 'SHOPEE', valor_pacote: shVal });
      await _loadAll();
      if(!defaultRates) _toast('Motoboy cadastrado. Defina as tarifas de ML e Shopee abaixo.');
    }

    _rerender(container);
  }

  async function _handleSaveMotorista(container){
    var nome = (container.querySelector('#mb-mot-nome') || {}).value || '';
    if(!nome.trim()){ _toast('Informe o nome do motorista.'); return; }
    var diaria = parseFloat((container.querySelector('#mb-mot-diaria') || {}).value);
    if(isNaN(diaria) || diaria < 0){ _toast('Valor de diária inválido.'); return; }
    var payload = {
      company_id: _companyId,
      nome: nome,
      telefone: (container.querySelector('#mb-mot-tel') || {}).value || '',
      valor_diaria: diaria,
      status: ((container.querySelector('#mb-mot-status') || {}).value) || 'Ativo'
    };
    if(_editingMotorista && _editingMotorista.id) payload.id = _editingMotorista.id;
    var result = await _repo.upsertMotorista(payload);
    if(result.error){ _toast(result.error.userMessage || 'Erro ao salvar.'); return; }
    _toast(_editingMotorista && _editingMotorista.id ? 'Motorista atualizado.' : 'Motorista cadastrado.');
    _editingMotorista = null;
    await _loadAll();
    _rerender(container);
  }

  // ─── Exportação pública ───────────────────────────────────────────────────

  window.GMFLEX.motoboysModule = {
    init: init,
    render: render,
    bindEvents: bindEvents,
    rerender: function(container){ _rerender(container); },
    loadEntries: _loadEntries,
    loadAll: _loadAll
  };

})();
