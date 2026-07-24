(function(){

  var DEFAULT_RATES = {"ICARO": {"ml": 10, "sh": 7}, "RENATO": {"ml": 10, "sh": 6}, "ELTON": {"ml": 10, "sh": 7}, "EVERTON": {"ml": 10, "sh": 7}, "DUDU": {"ml": 10, "sh": 6}, "CARECA": {"ml": 10, "sh": 6}, "ANDERSON": {"ml": 10, "sh": 6}, "WILSON": {"ml": 9.5, "sh": 6.5}, "FRANGO": {"ml": 10, "sh": 7}, "WESLEY": {"ml": 10, "sh": 6}, "BIBI": {"ml": 9.5, "sh": 6.5}, "RN ROBSON": {"ml": 10, "sh": 6}, "FABIANO": {"ml": 10, "sh": 7}, "VIP LOG": {"ml": 9.5, "sh": 6.5}, "LEONARDO": {"ml": 10, "sh": 7}, "MB": {"ml": 10, "sh": 6.25}, "AC": {"ml": 9.5, "sh": 7}, "SERGIO": {"ml": 9, "sh": 7}, "NOBRES": {"ml": 10, "sh": 6}, "KELLY": {"ml": 9, "sh": 6.5}, "SS": {"ml": 10, "sh": 7}, "RT": {"ml": 10, "sh": 7}, "KALIL": {"ml": 10, "sh": 6.5}, "DUO": {"ml": 10, "sh": 7}, "BIELOG": {"ml": 10, "sh": 6.5}};
  var RATES = Object.assign({}, DEFAULT_RATES);
  var CUSTOM_RATES_KEY = 'gmflex-financeiro-v3-parceiras-extra';

  var STORAGE_KEY = 'gmflex-financeiro-v3';
  var SETTINGS_KEY = 'gmflex-settings-v1';
  var AUDIT_KEY = 'gmflex-audit-v1';
  var PROFILE_CACHE_KEY = 'gmflex-supabase-profile-cache-v1';

  var settings = { empresa:'FINANCEIRO GM FLEX', responsavel:'GUILHERME MARQUES', telefone:'', email:'', tema:'claro', pin:'' };
  var services = { auth:null, repo:null, migration:null };
  var currentUser = null;
  var currentProfile = null;
  var currentCompany = null;
  var currentCompanyId = null;
  var realtimeChannel = null;
  var authMode = 'login';
  var authError = '';
  var authMessage = '';
  var authLoading = false;
  var appBooted = false;
  var loadedMonths = {};
  var entrySyncTimers = {};
  var syncStatus = { online:navigator.onLine, syncing:false, lastError:'', pending:0 };

  // ─── Proteção contra perda de foco em campos de quantidade (mobile) ──────
  // Eventos em tempo real (Supabase realtime) chegam toda vez que QUALQUER
  // lançamento é salvo — inclusive o próprio salvamento do usuário enquanto
  // ele ainda está digitando (debounce de 450ms em syncEntry/_persistDayEntry).
  // Um render() completo nesse momento recria todo o DOM via innerHTML,
  // derrubando o foco do <input> que está sendo editado. No desktop isso
  // passa quase despercebido; no celular o teclado virtual fecha e reabre
  // a cada dígito, dando a impressão de que "a página fica atualizando".
  // A solução: se o usuário estiver com foco num campo de quantidade
  // (Lançar ou Lançar Motoboy) quando um render de fundo for solicitado,
  // adiamos esse render até o campo perder o foco — sem alterar em nada
  // o salvamento, os dados ou qualquer outro fluxo do app.
  var pendingBackgroundRender = false;

  function isEditingQtyField(){
    var ae = document.activeElement;
    if(!ae) return false;
    var tag = (ae.tagName || '').toUpperCase();
    if(tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
    if(!ae.closest) return false;
    return !!(ae.closest('.driver-row') || ae.closest('[data-mb-lanc-row]') || ae.closest('.mb-launch-input') || ae.hasAttribute('data-mb-lanc-qtd'));
  }

  // Usada por atualizações de fundo (realtime, reconexão) que não devem
  // interromper o usuário enquanto ele digita. Renders disparados diretamente
  // por ações do próprio usuário (clique, troca de aba, etc.) continuam
  // chamando render() normalmente e não são afetados por esta função.
  function safeBackgroundRender(){
    if(isEditingQtyField()){
      pendingBackgroundRender = true;
      return;
    }
    render();
  }

  document.addEventListener('focusout', function(){
    if(!pendingBackgroundRender) return;
    pendingBackgroundRender = false;
    // pequeno atraso para permitir que o foco assente no próximo campo
    // (ex.: tab de ML para SH) antes de decidir se já é seguro re-renderizar
    setTimeout(function(){
      if(isEditingQtyField()){ pendingBackgroundRender = true; return; }
      render();
    }, 80);
  }, true);

  function loadSettingsCache(){
    try{ var raw = localStorage.getItem(SETTINGS_KEY); if(raw){ settings = Object.assign(settings, JSON.parse(raw)); } }catch(e){}
  }
  function saveSettingsCache(){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){} }
  function saveSettings(){ saveSettingsCache(); syncSettings(); }
  function applyTheme(){
    var root = document.getElementById('app-root');
    if(root){ root.classList.toggle('dark', settings.tema === 'escuro'); }
  }

  var auditLog = [];
  function loadAudit(){ try{ var raw = localStorage.getItem(AUDIT_KEY); auditLog = raw ? JSON.parse(raw) : []; }catch(e){ auditLog = []; } }
  function saveAuditCache(){ try{ localStorage.setItem(AUDIT_KEY, JSON.stringify(auditLog)); }catch(e){} }
  var auditPending = {}; var auditTimer = null;
  function audit(actionKey, text){
    auditPending[actionKey] = text;
    clearTimeout(auditTimer);
    auditTimer = setTimeout(function(){
      var now = new Date();
      var ts = now.toLocaleDateString('pt-BR') + ' ' + now.toTimeString().slice(0,5);
      Object.keys(auditPending).forEach(function(k){
        var item = {t:ts, a:auditPending[k]};
        auditLog.unshift(item);
        persistAudit(k, item);
      });
      auditPending = {};
      if(auditLog.length > 300) auditLog = auditLog.slice(0,300);
      saveAuditCache();
    }, 2500);
  }

  var toastTimer = null;
  function toast(msg){
    var el = document.getElementById('toast');
    if(!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2400);
  }

  function escapeHTML(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function escapeAttr(value){ return escapeHTML(value).replace(/`/g, '&#96;'); }
  function sanitizeText(value, fallback){
    value = String(value == null ? '' : value).replace(/[<>]/g, '').trim();
    return value || fallback || '';
  }
  function validEmail(value){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
  function friendlyError(error){
    if(!error) return '';
    return error.userMessage || error.message || 'Nao foi possivel concluir a operacao.';
  }
  function canManageCompany(){ return services.auth && services.auth.canManageCompany(currentProfile); }
  function canManageRates(){ return services.auth && services.auth.canManageRates(currentProfile); }
  function setSaveChip(text){
    var chip = document.getElementById('save-chip-text');
    if(chip) chip.textContent = text;
  }
  function updateSyncStatus(extra){
    syncStatus.online = navigator.onLine;
    syncStatus.pending = services.repo && services.repo.pendingCount ? services.repo.pendingCount() : syncStatus.pending;
    if(extra) syncStatus = Object.assign(syncStatus, extra);
  }

  var unlocked = false;

  // ─── Sistema de Módulos Opcionais ─────────────────────────────────────────
  var companyModules = {};  // { motoboys: true/false, ... }
  var motoboysModuleActive = false;
  var motoboysModuleInitialized = false;
  var motoboysContainer = null;
  // driverNames = TODAS as transportadoras já usadas (mantém histórico/relatórios corretos mesmo após remoção).
  // activeDriverNames = apenas as parceiras ativas (mostradas na tela de Lançar para novos lançamentos).
  var driverNames = Object.keys(RATES).sort(function(a,b){return a.localeCompare(b);});
  var activeDriverNames = [];
  function isActiveRate(name){ return !!RATES[name] && RATES[name].active !== false; }
  function refreshDriverNames(){
    driverNames = Object.keys(RATES).sort(function(a,b){return a.localeCompare(b);});
    activeDriverNames = driverNames.filter(isActiveRate);
  }
  var MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var WEEKDAY_SHORT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  var WEEKDAY_FULL = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

  function pad(n){ return n<10 ? '0'+n : ''+n; }
  function isoDate(y,m,d){ return y+'-'+pad(m)+'-'+pad(d); }
  function daysInMonth(y,m){ return new Date(y, m, 0).getDate(); }
  function firstWeekday(y,m){ return new Date(y, m-1, 1).getDay(); }
  function isSunday(y,m,d){ return new Date(y,m-1,d).getDay() === 0; }
  function todayISO(){ var t=new Date(); return isoDate(t.getFullYear(), t.getMonth()+1, t.getDate()); }
  function brDate(iso){ var p=iso.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; }

  var state = {
    entries: {},
    tab: 'lanc',
    year: 2026, month: 6,
    selectedDate: '2026-06-16',
    daySubTab: 'coleta',
    search: '',
    showAddForm: false,
    addFormError: null,
    showInactive: false,
    cfgMsg: null,
    sidebarOpen: false,  // Estado do menu lateral recolhível
    expandedFechDriver: null,  // Nome da transportadora com o detalhamento diário aberto no Fechamento
    // Custos do módulo Motoboys por dia, para o cálculo de "Lucro Líquido do dia" em Entrada de Pacotes.
    // Formato: { [date_key]: { totalMotoboys, totalDiarias } }. Recarregado a cada mudança de mês/login.
    // Vazio (nenhuma chave) sempre que o módulo Motoboys está desativado — nesse caso o Lucro Líquido
    // volta a ser exatamente igual à Entrada (sem custos a deduzir).
    motoboyCostsByDay: {}
  };

  function saveEntries(){
    var chip = document.getElementById('save-chip-text');
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
      if(chip) chip.textContent = syncStatus.online ? 'cache salvo' : 'offline';
    }catch(e){
      if(chip) chip.textContent = 'erro ao salvar';
    }
  }

  function saveRates(){
    try{
      // Salva o estado completo (inclui overrides de ativo/inativo mesmo para transportadoras padrão)
      localStorage.setItem(CUSTOM_RATES_KEY, JSON.stringify(RATES));
    }catch(e){ /* ignore */ }
  }

  function loadLocalCache(){
    loadSettingsCache();
    loadAudit();
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      state.entries = raw ? JSON.parse(raw) : {};
    }catch(e){ state.entries = {}; }

    try{
      var rawRates = localStorage.getItem(CUSTOM_RATES_KEY);
      if(rawRates){
        var extra = JSON.parse(rawRates);
        RATES = Object.assign({}, DEFAULT_RATES, extra);
      }
    }catch(e){ /* keep defaults */ }

    refreshDriverNames();
  }

  function cacheProfile(){
    if(!currentUser || !currentProfile) return;
    try{
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
        user: { id:currentUser.id, email:currentUser.email },
        profile: currentProfile,
        company: currentCompany
      }));
    }catch(error){}
  }

  function loadCachedProfile(){
    try{
      var raw = localStorage.getItem(PROFILE_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(error){
      return null;
    }
  }

  function clearCachedProfile(){
    try{ localStorage.removeItem(PROFILE_CACHE_KEY); }catch(error){}
  }

  function mapSettingsRow(row){
    if(!row) return;
    settings.empresa = row.empresa_nome || settings.empresa || 'FINANCEIRO GM FLEX';
    settings.responsavel = row.responsavel || settings.responsavel || '';
    settings.telefone = row.telefone || '';
    settings.email = row.email || '';
    settings.tema = row.tema === 'escuro' ? 'escuro' : 'claro';
    saveSettingsCache();
  }

  function mapRateRows(rows){
    if(!Array.isArray(rows) || rows.length === 0) return;
    RATES = {};
    rows.forEach(function(row){
      RATES[row.driver_name] = { ml:Number(row.ml_rate) || 0, sh:Number(row.sh_rate) || 0, active: row.active !== false };
    });
    refreshDriverNames();
    saveRates();
  }

  function isDateInMonth(dateKey, year, month){
    return dateKey >= isoDate(year, month, 1) && dateKey <= isoDate(year, month, daysInMonth(year, month));
  }

  function applyRemoteEntries(rows, year, month){
    Object.keys(state.entries).forEach(function(dateKey){
      if(isDateInMonth(dateKey, year, month)) delete state.entries[dateKey];
    });
    (rows || []).forEach(function(row){
      if(!state.entries[row.date_key]) state.entries[row.date_key] = {};
      state.entries[row.date_key][row.driver_name] = {
        ml: Number(row.ml_count) || 0,
        sh: Number(row.sh_count) || 0
      };
    });
    loadedMonths[year + '-' + month] = true;
    saveEntries();
  }

  function mapAuditRows(rows){
    if(!Array.isArray(rows)) return;
    auditLog = rows.map(function(row){
      var d = new Date(row.created_at);
      return {
        t: isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR') + ' ' + d.toTimeString().slice(0,5),
        a: row.description || row.action_key || 'Registro'
      };
    });
    saveAuditCache();
  }

  async function loadRemoteSettings(){
    if(!currentCompanyId || !services.repo) return;
    var result = await services.repo.getSettings(currentCompanyId);
    if(result.error){ syncStatus.lastError = friendlyError(result.error); return; }
    mapSettingsRow(result.data);
  }

  async function loadRemoteRates(){
    if(!currentCompanyId || !services.repo) return;
    var result = await services.repo.getRates(currentCompanyId);
    if(result.error){ syncStatus.lastError = friendlyError(result.error); return; }
    if(result.data && result.data.length) mapRateRows(result.data);
  }

  async function loadRemoteAudit(){
    if(!currentCompanyId || !services.repo) return;
    var result = await services.repo.getAuditLogs(currentCompanyId, 300);
    if(result.error){ syncStatus.lastError = friendlyError(result.error); return; }
    mapAuditRows(result.data);
  }

  async function loadRemoteModules(){
    if(!currentCompanyId || !window.GMFLEX.motoboysRepository) return;
    var mbRepo = window.GMFLEX.motoboysRepository;
    var result = await mbRepo.getModules(currentCompanyId);
    if(result.error) return;
    companyModules = {};
    (result.data || []).forEach(function(row){
      companyModules[row.module_name] = !!row.enabled;
    });
    motoboysModuleActive = !!companyModules['motoboys'];
  }

  async function loadRemoteEntriesForCurrentMonth(){
    if(!currentCompanyId || !services.repo) return;
    var result = await services.repo.getEntries(currentCompanyId, state.year, state.month);
    if(result.error){ syncStatus.lastError = friendlyError(result.error); return; }
    applyRemoteEntries(result.data || [], state.year, state.month);
  }

  // Busca em motoboy_entries os lançamentos do mês exibido (state.year/state.month) e agrega
  // Pago Motoboys + Diárias Motoristas por dia, para o cálculo de Lucro Líquido em "Entrada de
  // Pacotes". Só consulta se o módulo Motoboys estiver ativo para a empresa — por isso deve
  // rodar DEPOIS de loadRemoteModules() já ter atualizado motoboysModuleActive (ver refreshRemoteData
  // e changeMonth). Nunca lança erro para fora: falha de rede aqui não pode quebrar a tela de Lançar.
  async function loadRemoteMotoboyCostsForCurrentMonth(){
    if(!currentCompanyId || !window.GMFLEX.motoboysRepository) return;
    if(!motoboysModuleActive){ state.motoboyCostsByDay = {}; return; }
    var mbRepo = window.GMFLEX.motoboysRepository;
    var keys = monthDateKeys();
    if(!keys.length) return;
    var result = await mbRepo.getEntries(currentCompanyId, { dateFrom: keys[0], dateTo: keys[keys.length-1] });
    if(result.error){ return; } // mantém o cache anterior; Lucro Líquido segue funcionando com os últimos dados válidos
    state.motoboyCostsByDay = mbRepo.aggregateByDay(result.data || []);
  }

  async function refreshRemoteData(options){
    options = options || {};
    if(!currentCompanyId || !services.repo || !navigator.onLine) return;
    updateSyncStatus({ syncing:true, lastError:'' });
    if(options.renderBefore) render();
    var queueResult = await services.repo.processOfflineQueue(currentCompanyId);
    if(queueResult && queueResult.hasPermanentFailures){
      toast('Alguns itens não puderam ser sincronizados (' + queueResult.failed + '). Verifique em Configurações.');
    }
    await Promise.all([loadRemoteSettings(), loadRemoteRates(), loadRemoteAudit(), loadRemoteEntriesForCurrentMonth(), loadRemoteModules()]);
    await loadRemoteMotoboyCostsForCurrentMonth(); // depende de motoboysModuleActive, já atualizado acima
    updateSyncStatus({ syncing:false });
    render();
  }

  function entryPayload(dateKey, driver){
    var e = getDriverEntry(dateKey, driver);
    return {
      company_id: currentCompanyId,
      date_key: dateKey,
      driver_name: driver,
      ml_count: e.ml || 0,
      sh_count: e.sh || 0
    };
  }

  async function syncEntry(dateKey, driver){
    if(!currentCompanyId || !services.repo) return;
    setSaveChip(syncStatus.online ? 'sincronizando' : 'offline');
    var result = await services.repo.upsertEntry(entryPayload(dateKey, driver));
    updateSyncStatus();
    if(result.queued){
      setSaveChip('offline');
      return;
    }
    if(result.error){
      setSaveChip('erro ao sincronizar');
      toast(friendlyError(result.error));
      return;
    }
    setSaveChip('salvo');
  }

  function scheduleEntrySync(dateKey, driver){
    var key = dateKey + ':' + driver;
    clearTimeout(entrySyncTimers[key]);
    entrySyncTimers[key] = setTimeout(function(){ syncEntry(dateKey, driver); }, 450);
  }

  var migrationWarningShown = false;
  async function syncRate(driver){
    if(!currentCompanyId || !services.repo || !RATES[driver]) return;
    var result = await services.repo.upsertRate({
      company_id: currentCompanyId,
      driver_name: driver,
      ml_rate: RATES[driver].ml,
      sh_rate: RATES[driver].sh,
      active: RATES[driver].active !== false
    });
    updateSyncStatus();
    if(result.error && !result.queued) toast(friendlyError(result.error));
    if(result.migrationNeeded && !migrationWarningShown){
      migrationWarningShown = true;
      toast('Atenção: rode a migração SQL mais recente no Supabase (coluna "active" em driver_rates) para o remover/reativar transportadoras funcionar após atualizar a página.');
    }
  }

  async function syncSettings(){
    if(!currentCompanyId || !services.repo) return;
    var payload = {
      company_id: currentCompanyId,
      empresa_nome: settings.empresa,
      responsavel: settings.responsavel,
      telefone: settings.telefone,
      email: settings.email,
      tema: settings.tema
    };
    var settingsResult = await services.repo.updateSettings(payload);
    var companyResult = await services.repo.updateCompany(currentCompanyId, { nome:settings.empresa || 'FINANCEIRO GM FLEX' });
    updateSyncStatus();
    if((settingsResult.error && !settingsResult.queued) || (companyResult.error && !companyResult.queued)){
      toast(friendlyError(settingsResult.error || companyResult.error));
    }
  }

  async function persistAudit(actionKey, item){
    if(!currentCompanyId || !services.repo) return;
    await services.repo.createAuditLog({
      company_id: currentCompanyId,
      user_id: currentUser ? currentUser.id : null,
      action_key: actionKey,
      description: item.a,
      created_at: new Date().toISOString()
    });
    updateSyncStatus();
  }

  async function restoreBackupRemote(data){
    if(!currentCompanyId || !services.repo) return;
    var tasks = [];
    Object.keys(state.entries || {}).forEach(function(dateKey){
      Object.keys(state.entries[dateKey] || {}).forEach(function(driver){
        tasks.push(services.repo.upsertEntry(entryPayload(dateKey, driver)));
      });
    });
    Object.keys(RATES || {}).forEach(function(driver){
      tasks.push(services.repo.upsertRate({
        company_id: currentCompanyId,
        driver_name: driver,
        ml_rate: RATES[driver].ml,
        sh_rate: RATES[driver].sh
      }));
    });
    tasks.push(services.repo.updateSettings({
      company_id: currentCompanyId,
      empresa_nome: settings.empresa,
      responsavel: settings.responsavel,
      telefone: settings.telefone,
      email: settings.email,
      tema: settings.tema
    }));
    await Promise.all(tasks);
    updateSyncStatus();
  }

  function applyRealtimeEntry(payload){
    var row = payload.new || payload.old;
    if(!row || !isDateInMonth(row.date_key, state.year, state.month)) return;
    if(payload.eventType === 'DELETE'){
      if(state.entries[row.date_key]) delete state.entries[row.date_key][row.driver_name];
    }else{
      if(!state.entries[row.date_key]) state.entries[row.date_key] = {};
      state.entries[row.date_key][row.driver_name] = { ml:Number(row.ml_count) || 0, sh:Number(row.sh_count) || 0 };
    }
    saveEntries();
  }

  function applyRealtimeRate(payload){
    var row = payload.new || payload.old;
    if(!row) return;
    if(payload.eventType === 'DELETE') delete RATES[row.driver_name];
    else RATES[row.driver_name] = { ml:Number(row.ml_rate) || 0, sh:Number(row.sh_rate) || 0, active: row.active !== false };
    refreshDriverNames();
    saveRates();
  }

  async function handleRealtime(table, payload){
    if(table === 'entries') applyRealtimeEntry(payload);
    else if(table === 'driver_rates') applyRealtimeRate(payload);
    else if(table === 'settings') mapSettingsRow(payload.new);
    else if(table === 'companies' && payload.new){ currentCompany = payload.new; settings.empresa = payload.new.nome || settings.empresa; saveSettingsCache(); }
    else if(table === 'audit_logs') await loadRemoteAudit();
    else if(table === 'profiles' && payload.new && currentUser && payload.new.id === currentUser.id) currentProfile = payload.new;
    updateSyncStatus();
    safeBackgroundRender();
  }

  function setupRealtime(){
    if(!services.repo || !currentCompanyId || !navigator.onLine) return;
    if(realtimeChannel && window.supabaseClient){
      window.supabaseClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    realtimeChannel = services.repo.subscribeToCompanyChanges(currentCompanyId, handleRealtime);
  }

  async function handleOnline(){
    updateSyncStatus({ online:true, syncing:true, lastError:'' });
    toast('Conexao restaurada. Sincronizando...');
    render();
    await refreshRemoteData();
    setupRealtime();
    updateSyncStatus({ syncing:false });
  }

  function handleOffline(){
    updateSyncStatus({ online:false, syncing:false });
    toast('Sem internet. Alteracoes serao sincronizadas depois.');
    render();
  }

  // Salva imediatamente sempre que o app for minimizado, trocar de aba ou fechar
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden') saveEntries();
  });
  window.addEventListener('pagehide', saveEntries);
  window.addEventListener('beforeunload', saveEntries);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  function addCustomPartner(name, ml, sh){
    if(!canManageRates()) return {ok:false, msg:'Seu perfil não tem permissão para cadastrar transportadoras.'};
    name = sanitizeText(name, '').toUpperCase();
    if(!name) return {ok:false, msg:'Digite o nome da transportadora.'};
    var reactivating = !!RATES[name] && RATES[name].active === false;
    if(RATES[name] && !reactivating) return {ok:false, msg:'Já existe uma transportadora com esse nome.'};
    var mlRate = parseFloat((ml||'').toString().replace(',','.'));
    var shRate = parseFloat((sh||'').toString().replace(',','.'));
    if(isNaN(mlRate) || isNaN(shRate) || mlRate<0 || shRate<0) return {ok:false, msg:'Informe taxas válidas para ML e SH.'};
    RATES[name] = {ml:mlRate, sh:shRate, active:true};
    refreshDriverNames();
    saveRates();
    syncRate(name);
    audit('p:'+name, (reactivating ? 'Transportadora reativada — ' : 'Transportadora cadastrada — ')+name+' (ML R$'+mlRate+' / SH R$'+shRate+')');
    return {ok:true, name:name};
  }

  // Remove uma transportadora da lista de lançamento.
  // Se ela já tiver lançamentos registrados (nesse mês ou em qualquer mês), apenas desativa
  // (mantém o histórico e os relatórios corretos). Se nunca foi usada, exclui de vez.
  async function removePartner(name){
    if(!canManageRates()) return {ok:false, msg:'Seu perfil não tem permissão para remover transportadoras.'};
    name = sanitizeText(name, '').toUpperCase();
    if(!RATES[name]) return {ok:false, msg:'Transportadora não encontrada.'};

    var usedThisMonth = Object.keys(state.entries).some(function(dateKey){
      var d = state.entries[dateKey];
      return d && d[name] && ((d[name].ml||0) > 0 || (d[name].sh||0) > 0);
    });
    var usedEver = usedThisMonth;
    if(!usedEver && services.repo && currentCompanyId && navigator.onLine){
      var check = await services.repo.hasEntriesForDriver(currentCompanyId, name);
      if(!check.error) usedEver = !!check.hasEntries;
    } else if(!usedEver){
      // offline ou sem repo: por segurança, apenas desativa em vez de excluir de vez
      usedEver = true;
    }

    if(usedEver){
      RATES[name].active = false;
      refreshDriverNames();
      saveRates();
      syncRate(name);
      audit('p:'+name, 'Transportadora removida da lista de lançamento — '+name+' (histórico preservado)');
      return {ok:true, mode:'inactive', name:name};
    }

    delete RATES[name];
    refreshDriverNames();
    saveRates();
    if(services.repo && currentCompanyId){
      var result = await services.repo.deleteRate(currentCompanyId, name);
      if(result.error && !result.queued) toast(friendlyError(result.error));
    }
    audit('p:'+name, 'Transportadora excluída — '+name);
    return {ok:true, mode:'deleted', name:name};
  }

  function reactivatePartner(name){
    if(!canManageRates()) return {ok:false, msg:'Seu perfil não tem permissão para reativar transportadoras.'};
    name = sanitizeText(name, '').toUpperCase();
    if(!RATES[name]) return {ok:false, msg:'Transportadora não encontrada.'};
    RATES[name].active = true;
    refreshDriverNames();
    saveRates();
    syncRate(name);
    audit('p:'+name, 'Transportadora reativada — '+name);
    return {ok:true, name:name};
  }

  function getDriverEntry(dateKey, driver){
    var d = state.entries[dateKey];
    if(!d || !d[driver]) return {ml:null, sh:null};
    return d[driver];
  }
  function setDriverField(dateKey, driver, field, value){
    if(!state.entries[dateKey]) state.entries[dateKey] = {};
    if(!state.entries[dateKey][driver]) state.entries[dateKey][driver] = {ml:0, sh:0};
    var v = value === '' ? 0 : Math.max(0, parseInt(value,10) || 0);
    state.entries[dateKey][driver][field] = v;
    saveEntries();
    scheduleEntrySync(dateKey, driver);
    audit('l:'+dateKey+':'+driver, 'Lançamento alterado — '+driver+' em '+brDate(dateKey));
  }

  function money(v){
    var neg = v<0;
    var s = 'R$ ' + Math.abs(v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    return neg ? '-'+s : s;
  }

  // Converte para número válido e não-negativo; caso contrário retorna o padrão.
  function numOr(v, fallback){
    var n = Number(v);
    return (isFinite(n) && n >= 0) ? n : fallback;
  }

  function dayDriverValor(dateKey, driver){
    var e = getDriverEntry(dateKey, driver);
    var r = RATES[driver];
    return (e.ml||0)*r.ml + (e.sh||0)*r.sh;
  }
  function dayReceber(dateKey){
    var tot = 0;
    driverNames.forEach(function(dr){ tot += dayDriverValor(dateKey, dr); });
    return tot;
  }
  // "ENTRADA" = valor dos pacotes que entraram no dia, calculado com a taxa de cada transportadora parceira
  // (é a mesma base de cálculo do "A Receber", mas aberta por plataforma ML / SH)
  function dayEntradaValor(dateKey){
    var d = state.entries[dateKey];
    var valorML=0, valorSH=0, qtdML=0, qtdSH=0;
    if(d){
      driverNames.forEach(function(dr){
        if(d[dr]){
          var r = RATES[dr];
          var ml = d[dr].ml||0, sh = d[dr].sh||0;
          qtdML += ml; qtdSH += sh;
          valorML += ml*r.ml; valorSH += sh*r.sh;
        }
      });
    }
    return { qtdML:qtdML, qtdSH:qtdSH, valorML:valorML, valorSH:valorSH, total:valorML+valorSH };
  }
  // Pago Motoboys + Diárias Motoristas já lançados no módulo Motoboys para este dia
  // (vem de state.motoboyCostsByDay, carregado por loadRemoteMotoboyCostsForCurrentMonth).
  // Se o módulo estiver desativado ou os dados ainda não tiverem chegado, retorna 0/0 —
  // nunca lança erro e nunca deixa o Lucro Líquido quebrado ou com NaN.
  function dayMotoboyCosts(dateKey){
    var c = state.motoboyCostsByDay && state.motoboyCostsByDay[dateKey];
    return {
      totalMotoboys: c ? (c.totalMotoboys || 0) : 0,
      totalDiarias: c ? (c.totalDiarias || 0) : 0
    };
  }

  // Fonte única do "Lucro Líquido do dia" (Entrada de Pacotes):
  //   Lucro Líquido = Entrada − Pago Motoboys − Diárias Motoristas
  // Usada no card e rodapé de "Entrada de Pacotes", no Fechamento, no Dashboard e no PDF,
  // para nunca haver dois números diferentes de "lucro do dia" em telas diferentes.
  function dayLucroLiquido(dateKey){
    var ent = dayEntradaValor(dateKey);
    var mb = dayMotoboyCosts(dateKey);
    var lucroLiquido = ent.total - mb.totalMotoboys - mb.totalDiarias;
    return {
      ent: ent,
      totalMotoboys: mb.totalMotoboys,
      totalDiarias: mb.totalDiarias,
      lucroLiquido: Math.round(lucroLiquido * 100) / 100
    };
  }
  // Mantido por compatibilidade — nenhum outro arquivo do projeto chama dayLucro().
  function dayLucro(dateKey){
    return dayLucroLiquido(dateKey).lucroLiquido;
  }

  function monthDateKeys(){
    var n = daysInMonth(state.year, state.month);
    var keys = [];
    for(var d=1; d<=n; d++) keys.push(isoDate(state.year, state.month, d));
    return keys;
  }
  function quinzenaKeys(which){
    var n = daysInMonth(state.year, state.month);
    var keys = [];
    var start = which===1 ? 1 : 16;
    var end = which===1 ? 15 : n;
    for(var d=start; d<=end; d++) keys.push(isoDate(state.year, state.month, d));
    return keys;
  }
  // Totais de um período (mês/quinzena): Receita (A Receber), custos de Motoboys/Diárias
  // e o Lucro Líquido resultante — consistente com a mesma fórmula usada em dayLucroLiquido.
  function rangeTotals(keys){
    var receber=0, totalMotoboys=0, totalDiarias=0;
    keys.forEach(function(k){
      receber += dayReceber(k);
      var mb = dayMotoboyCosts(k);
      totalMotoboys += mb.totalMotoboys;
      totalDiarias += mb.totalDiarias;
    });
    var custos = totalMotoboys + totalDiarias;
    return { receber:receber, totalMotoboys:totalMotoboys, totalDiarias:totalDiarias, custos:custos, lucro:receber-custos };
  }

  function iconSearch(){ return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'; }
  function iconMoto(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="#161616" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M5.5 17.5 9 10h4l3 4.5h2"/><path d="M9 10 8 6h3"/></svg>'; }
  function iconPDF(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="#E2231A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6M9 11h2"/></svg>'; }

  function changeMonth(delta){
    var m = state.month + delta, y = state.year;
    if(m > 12){ m = 1; y++; } else if(m < 1){ m = 12; y--; }
    state.year = y; state.month = m;
    state.selectedDate = isoDate(y, m, 1);
    render();
    if(currentCompanyId && navigator.onLine){
      Promise.all([loadRemoteEntriesForCurrentMonth(), loadRemoteMotoboyCostsForCurrentMonth()]).then(function(){ render(); });
    }
  }

  function iconNav(name){
    var s = 'width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    if(name==='lanc') return '<svg '+s+'><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    if(name==='fech') return '<svg '+s+'><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>';
    if(name==='dash') return '<svg '+s+'><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>';
    if(name==='motoboys') return '<svg '+s+'><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M5.5 17.5 9 10h4l3 4.5h2"/><path d="M9 10 8 6h3"/></svg>';
    return '<svg '+s+'><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  }

  function hideSplash(){
    var sp = document.getElementById('splash');
    if(sp){ sp.classList.add('hide'); setTimeout(function(){ if(sp.parentNode) sp.remove(); }, 600); }
  }

  function renderLoading(message){
    var root = document.getElementById('app-root');
    applyTheme();
    root.innerHTML = '<div class="auth-container"><div class="auth-card">'
      + '<h2>'+escapeHTML(message || 'Carregando...')+'</h2>'
      + '<div class="cfg-sub">Aguarde um instante.</div>'
      + '</div></div>';
  }

  function renderAuthScreen(){
    var root = document.getElementById('app-root');
    root.classList.toggle('dark', settings.tema === 'escuro');
    var title = authMode === 'signup' ? 'Criar conta' : authMode === 'recover' ? 'Recuperar senha' : authMode === 'update' ? 'Nova senha' : 'Entrar';
    var submit = authMode === 'signup' ? 'Cadastrar' : authMode === 'recover' ? 'Enviar link' : authMode === 'update' ? 'Salvar senha' : 'Entrar';
    var h = '<div class="auth-container"><div class="auth-card">';
    h += '<h2>'+title+'</h2>';
    if(authError) h += '<div class="auth-error">'+escapeHTML(authError)+'</div>';
    if(authMessage) h += '<div class="off-banner" style="background:#E7F3EA;border-color:#BFDCC7;color:var(--green);">'+escapeHTML(authMessage)+'</div>';
    if(authMode === 'signup'){
      h += '<input class="auth-input" id="auth-nome" type="text" autocomplete="name" placeholder="Nome completo"/>';
      h += '<input class="auth-input" id="auth-company" type="text" autocomplete="organization" placeholder="Empresa"/>';
      h += '<input class="auth-input" id="auth-invite" type="text" autocomplete="off" placeholder="Token de convite (opcional)"/>';
    }
    if(authMode !== 'update'){
      h += '<input class="auth-input" id="auth-email" type="email" autocomplete="email" placeholder="E-mail"/>';
    }
    if(authMode !== 'recover'){
      h += '<input class="auth-input" id="auth-password" type="password" autocomplete="'+(authMode === 'login' ? 'current-password' : 'new-password')+'" placeholder="Senha"/>';
    }
    h += '<button class="auth-btn" id="auth-submit">'+(authLoading ? 'Aguarde...' : submit)+'</button>';
    if(authMode === 'login'){
      h += '<div class="auth-link" data-auth-mode="signup">Criar conta</div>';
      h += '<div class="auth-link" data-auth-mode="recover">Esqueci minha senha</div>';
    }else if(authMode !== 'update'){
      h += '<div class="auth-link" data-auth-mode="login">Voltar para login</div>';
    }
    h += '</div></div>';
    root.innerHTML = h;
    bindAuthEvents();
    hideSplash();
  }

  function bindAuthEvents(){
    document.querySelectorAll('[data-auth-mode]').forEach(function(link){
      link.addEventListener('click', function(){
        authMode = link.getAttribute('data-auth-mode');
        authError = '';
        authMessage = '';
        renderAuthScreen();
      });
    });
    var btn = document.getElementById('auth-submit');
    if(btn) btn.addEventListener('click', handleAuthSubmit);
    document.querySelectorAll('.auth-input').forEach(function(inp){
      inp.addEventListener('keydown', function(e){ if(e.key === 'Enter') handleAuthSubmit(); });
    });
  }

  async function handleAuthSubmit(){
    if(authLoading || !services.auth) return;

    // IMPORTANTE: ler todos os campos do formulario ANTES de qualquer renderAuthScreen(),
    // pois renderAuthScreen() recria o HTML dos inputs (root.innerHTML = ...) e apaga
    // qualquer valor digitado. Ler depois do render sempre resultava em campos vazios.
    var emailEl = document.getElementById('auth-email');
    var passEl = document.getElementById('auth-password');
    var email = emailEl ? emailEl.value.trim() : '';
    var password = passEl ? passEl.value : '';

    var nome, company, invite;
    if(authMode === 'signup'){
      var nomeEl = document.getElementById('auth-nome');
      var companyEl = document.getElementById('auth-company');
      var inviteEl = document.getElementById('auth-invite');
      nome = sanitizeText(nomeEl ? nomeEl.value : '', '');
      company = sanitizeText(companyEl ? companyEl.value : '', 'FINANCEIRO GM FLEX');
      invite = sanitizeText(inviteEl ? inviteEl.value : '', '');
    }

    authError = '';
    authMessage = '';
    authLoading = true;
    renderAuthScreen();

    if(authMode !== 'update' && !validEmail(email)){
      authLoading = false; authError = 'Informe um e-mail valido.'; renderAuthScreen(); return;
    }
    if(authMode !== 'recover' && (!password || password.length < 6)){
      authLoading = false; authError = 'A senha precisa ter pelo menos 6 caracteres.'; renderAuthScreen(); return;
    }

    var result;
    if(authMode === 'login'){
      result = await services.auth.signIn(email, password);
      if(!result.error && result.data && result.data.user) await startAuthenticated(result.data.user);
    }else if(authMode === 'signup'){
      if(!nome){ authLoading = false; authError = 'Informe seu nome.'; renderAuthScreen(); return; }
      result = await services.auth.signUp({ email:email, password:password, nome:nome, companyName:company, inviteToken:invite });
      if(!result.error && result.data && result.data.session && result.data.user){
        await startAuthenticated(result.data.user);
      }else if(!result.error){
        authMode = 'login';
        authMessage = 'Cadastro criado. Confirme o e-mail se o Supabase solicitar e entre com sua senha.';
      }
    }else if(authMode === 'recover'){
      result = await services.auth.resetPassword(email);
      if(!result.error) authMessage = 'Enviamos um link de recuperacao para seu e-mail.';
    }else if(authMode === 'update'){
      result = await services.auth.updatePassword(password);
      if(!result.error){
        authMode = 'login';
        authMessage = 'Senha atualizada. Entre novamente.';
        await services.auth.signOut();
        if(window.history && window.history.replaceState) window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    authLoading = false;
    if(result && result.error) authError = friendlyError(result.error);
    if(!currentUser) renderAuthScreen();
  }

  async function ensureProfile(user){
    var profileResult = await services.auth.getProfile(user.id);
    if(profileResult.error || !profileResult.data){
      var ensured = await services.repo.ensureUserCompany(settings.empresa || 'FINANCEIRO GM FLEX');
      if(ensured.error) return { data:null, error:ensured.error };
      profileResult = await services.auth.getProfile(user.id);
    }
    return profileResult;
  }

  async function doLogout(){
    var btn = document.getElementById('cfg-logout');
    if(btn){ btn.disabled = true; btn.textContent = 'Saindo...'; }

    if(realtimeChannel && window.supabaseClient){
      try{ window.supabaseClient.removeChannel(realtimeChannel); }catch(error){}
      realtimeChannel = null;
    }

    var result = await services.auth.signOut();

    // Independente da resposta do servidor, garantimos a saída local:
    // se a sessão já não é mais válida (ex: sem internet), o usuário
    // não pode ficar preso na tela logada.
    currentUser = null;
    currentProfile = null;
    currentCompany = null;
    currentCompanyId = null;
    appBooted = false;
    authMode = 'login';
    authError = '';
    authMessage = '';
    companyModules = {};
    motoboysModuleActive = false;
    motoboysModuleInitialized = false;
    state.tab = 'lanc';
    clearCachedProfile();
    renderAuthScreen();

    if(result && result.error){
      toast('Sessão local encerrada. ' + (friendlyError(result.error) || 'Não foi possível confirmar a saída no servidor.'));
    }
  }

  async function startAuthenticated(user){
    if(appBooted && currentUser && currentUser.id === user.id) return;
    appBooted = true;
    currentUser = user;
    renderLoading('Carregando dados');

    if(!navigator.onLine){
      var cached = loadCachedProfile();
      if(cached && cached.user && cached.user.id === user.id && cached.profile){
        currentProfile = cached.profile;
        currentCompany = cached.company || null;
        currentCompanyId = currentProfile.company_id;
        render();
        hideSplash();
        return;
      }
      authError = 'Sem internet para validar seu perfil neste aparelho.';
      authMode = 'login';
      currentUser = null;
      appBooted = false;
      renderAuthScreen();
      return;
    }

    var profileResult = await ensureProfile(user);
    if(profileResult.error || !profileResult.data){
      authError = friendlyError(profileResult.error);
      currentUser = null;
      appBooted = false;
      renderAuthScreen();
      return;
    }

    currentProfile = profileResult.data;
    currentCompanyId = currentProfile.company_id;
    var companyResult = await services.repo.getCompany(currentCompanyId);
    if(!companyResult.error) currentCompany = companyResult.data;
    cacheProfile();

    try{
      await services.migration.migrateLocalStorage(currentCompanyId, DEFAULT_RATES, settings, currentUser.id);
    }catch(error){
      syncStatus.lastError = 'Nao foi possivel migrar todos os dados locais agora.';
    }

    await refreshRemoteData({ renderBefore:true });
    setupRealtime();
    render();
    hideSplash();
  }

  async function boot(){
    loadLocalCache();
    renderLoading('Conectando ao Supabase');
    var client = window.GMFLEX.initSupabase ? window.GMFLEX.initSupabase() : null;
    services.auth = window.GMFLEX.authService || null;
    services.repo = window.GMFLEX.dataRepository || null;
    services.migration = window.GMFLEX.migrationService || null;

    if(!client || !services.auth || !services.repo || !services.migration){
      authError = 'Configure o Supabase no arquivo env.js antes de usar o sistema.';
      renderAuthScreen();
      return;
    }

    services.auth.onAuthStateChange(function(event, session){
      if(event === 'PASSWORD_RECOVERY'){
        authMode = 'update';
        authError = '';
        authMessage = 'Digite sua nova senha.';
        renderAuthScreen();
        return;
      }
      if(event === 'SIGNED_OUT'){
        if(realtimeChannel && window.supabaseClient){
          try{ window.supabaseClient.removeChannel(realtimeChannel); }catch(error){}
          realtimeChannel = null;
        }
        currentUser = null;
        currentProfile = null;
        currentCompany = null;
        currentCompanyId = null;
        appBooted = false;
        authMode = 'login';
        companyModules = {};
        motoboysModuleActive = false;
        motoboysModuleInitialized = false;
        state.tab = 'lanc';
        clearCachedProfile();
        renderAuthScreen();
        return;
      }
      if(session && session.user && (!currentUser || currentUser.id !== session.user.id)){
        startAuthenticated(session.user);
      }
    });

    var sessionResult = await services.auth.getSession();
    if(sessionResult.error){
      authError = friendlyError(sessionResult.error);
      renderAuthScreen();
      return;
    }
    if(sessionResult.data && sessionResult.data.session && sessionResult.data.session.user){
      await startAuthenticated(sessionResult.data.session.user);
    }else{
      renderAuthScreen();
    }
  }

  function renderLockScreen(){
    var root = document.getElementById('app-root');
    root.classList.toggle('dark', settings.tema === 'escuro');
    root.innerHTML = '<div class="lock-screen">'
      + '<div class="s-mark"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M5.5 17.5 9 10h4l3 4.5h2"/><path d="M9 10 8 6h3"/></svg></div>'
      + '<h2>'+escapeHTML(settings.empresa||'FINANCEIRO GM FLEX')+'</h2>'
      + '<input class="lock-input" id="lock-pin" type="password" inputmode="numeric" maxlength="8" placeholder="••••"/>'
      + '<div class="lock-error" id="lock-error"></div>'
      + '<button class="lock-btn" id="lock-enter">Entrar</button>'
      + '</div>';
    function tryUnlock(){
      var v = document.getElementById('lock-pin').value;
      if(v === settings.pin){ unlocked = true; render(); }
      else { document.getElementById('lock-error').textContent = 'Senha incorreta.'; }
    }
    document.getElementById('lock-enter').addEventListener('click', tryUnlock);
    document.getElementById('lock-pin').addEventListener('keydown', function(e){ if(e.key==='Enter') tryUnlock(); });
  }

  function render(){
    if(settings.pin && !unlocked){ renderLockScreen(); return; }
    var root = document.getElementById('app-root');
    applyTheme();
    var html = '';
    html += renderSyncStatus();
    
    // Layout com sidebar recolhível
    html += '<div class="app-layout '+(state.sidebarOpen?'sidebar-open':'sidebar-closed')+'">';
    
    // Sidebar (menu lateral)
    html += '<aside class="sidebar '+(state.sidebarOpen?'open':'closed')+'" id="app-sidebar">';
    html += '  <div class="sidebar-header">';
    html += '    <div class="sidebar-brand"><div class="sidebar-mark">'+iconMoto()+'</div><div class="sidebar-title">'+escapeHTML(settings.empresa||'FINANCEIRO GM FLEX')+'</div></div>';
    html += '    <button class="sidebar-close" id="sidebar-close-btn" aria-label="Fechar menu">✕</button>';
    html += '  </div>';
    html += '  <nav class="sidebar-nav">';
    var navTabs = [['lanc','Lançar'],['fech','Fechamento'],['dash','Dashboard'],['config','Ajustes']];
    if(motoboysModuleActive) navTabs.splice(2, 0, ['motoboys','Motoboys']);
    navTabs.forEach(function(t){
      html += '<button class="sidebar-item '+(state.tab===t[0]?'active':'')+' " data-tab="'+t[0]+'">'+iconNav(t[0])+'<span>'+t[1]+'</span></button>';
    });
    html += '  </nav>';
    html += '</aside>';
    
    // Overlay do sidebar
    html += '<div class="sidebar-overlay '+(state.sidebarOpen?'show':'')+' " id="sidebar-overlay"></div>';
    
    // Conteúdo principal
    html += '<div class="main-content">';
    html += '<header class="topbar">';
    html += '  <div class="brand-row">';
    html += '    <button class="menu-toggle" id="menu-toggle-btn" aria-label="Abrir menu">☰</button>';
    html += '    <div class="brand"><div class="brand-mark">'+iconMoto()+'</div>';
    html += '      <div class="brand-text"><h1>'+escapeHTML(settings.empresa||'FINANCEIRO GM FLEX')+'</h1><span>'+escapeHTML(settings.responsavel||'')+'</span></div></div>';
    html += '  </div>';
    html += '</header>';
    
    if(state.tab !== 'config' && state.tab !== 'motoboys'){
      html += '<div class="monthnav"><button data-nav="-1">‹</button><div class="mtitle">'+MONTH_NAMES[state.month-1]+' '+state.year+'</div><button data-nav="1">›</button></div>';
    }

    if(state.tab === 'lanc'){ html += renderLancamento(); }
    else if(state.tab === 'fech'){ html += renderFechamento(); }
    else if(state.tab === 'dash'){ html += renderDashboard(); }
    else if(state.tab === 'motoboys' && motoboysModuleActive){ html += renderMotoboysModule(); }
    else { html += renderConfig(); }
    
    html += '</div>'; // fecha main-content
    html += '</div>'; // fecha app-layout

    root.innerHTML = html;
    bindEvents();
    if(state.tab === 'dash') initDashboardCharts();
  }

  function renderSyncStatus(){
    updateSyncStatus();
    var label = syncStatus.syncing ? 'sincronizando' : syncStatus.online ? (syncStatus.pending > 0 ? 'pendente' : 'online') : 'offline';
    return '<div class="sync-status '+(syncStatus.online?'sync-online':'sync-offline')+'">'+escapeHTML(label)+'</div>';
  }

  // ─── Render do Módulo Motoboys ───────────────────────────────────────────────
  // Receita Total das Transportadoras = soma dos lançamentos (ml_count*ml_rate + sh_count*sh_rate)
  // no MESMO intervalo de datas que está sendo analisado no módulo Motoboys.
  // É a fonte oficial para o cálculo do Lucro Líquido:
  // Lucro Líquido = Receita Transportadoras − Total Pago Motoboys − Total Diárias Motoristas
  //
  // CORREÇÃO IMPORTANTE: esta função aceita um intervalo de datas (dateFrom/dateTo) e
  // busca os lançamentos diretamente do Supabase para esse intervalo específico - ela
  // NÃO usa mais um valor fixo do "mês atual". Antes, o Lucro Líquido exibido no
  // Dashboard/Relatórios de Motoboys usava sempre a receita do mês corrente inteiro,
  // mesmo quando o usuário filtrava por "Hoje", "Semana", "Ano", período customizado
  // ou por um motoboy específico - o que produzia um Lucro Líquido completamente
  // incorreto (ex: receita do mês inteiro menos pagamentos de só um dia).
  async function getReceitaTransportadorasRange(dateFrom, dateTo){
    if(!currentCompanyId || !services.repo || !dateFrom || !dateTo) return 0;
    var result = await services.repo.getEntriesRange(currentCompanyId, dateFrom, dateTo);
    if(result.error || !Array.isArray(result.data)) return 0;
    var total = 0;
    result.data.forEach(function(row){
      var r = RATES[row.driver_name];
      if(!r) return; // transportadora sem tarifa cadastrada não entra no cálculo
      total += (Number(row.ml_count) || 0) * r.ml + (Number(row.sh_count) || 0) * r.sh;
    });
    return Math.round(total * 100) / 100;
  }

  function renderMotoboysModule(){
    if(!window.GMFLEX.motoboysModule){
      return '<main class="view-config"><div class="cfg-card"><div class="cfg-sub">Módulo Motoboys não carregado. Verifique o arquivo motoboysModule.js.</div></div></main>';
    }
    var mbMod = window.GMFLEX.motoboysModule;
    if(!motoboysModuleInitialized){
      motoboysModuleInitialized = true;
      mbMod.init(
        currentCompanyId,
        window.GMFLEX.motoboysRepository,
        canManageRates(),
        toast,
        getReceitaTransportadorasRange,   // função assíncrona (dateFrom, dateTo) -> receita do período
        {                                  // usuário autenticado atual (Adiantamentos: "usuário responsável")
          id: currentUser ? currentUser.id : null,
          nome: currentProfile ? currentProfile.nome : (currentUser ? currentUser.email : '')
        }
      );
    }
    return '<main class="view-motoboys">'+mbMod.render()+'</main>';
  }

  function renderConfig(){
    var h = '<main class="view-config">';
    if(state.cfgMsg){ h += '<div class="off-banner" style="background:#E7F3EA;border-color:#BFDCC7;color:var(--green);">'+escapeHTML(state.cfgMsg)+'</div>'; state.cfgMsg = null; }

    h += '<div class="cfg-card"><h4>Dados da empresa</h4>';
    h += '<input class="cfg-input" id="cfg-empresa" placeholder="Nome da empresa" value="'+escapeAttr(settings.empresa||'')+'"/>';
    h += '<input class="cfg-input" id="cfg-resp" placeholder="Responsável" value="'+escapeAttr(settings.responsavel||'')+'"/>';
    h += '<input class="cfg-input" id="cfg-tel" placeholder="Telefone" value="'+escapeAttr(settings.telefone||'')+'"/>';
    h += '<input class="cfg-input" id="cfg-email" placeholder="E-mail" value="'+escapeAttr(settings.email||'')+'"/>';
    h += '<button class="cfg-btn" id="cfg-save-empresa">Salvar dados</button>';
    h += '</div>';

    h += '<div class="cfg-card"><h4>Aparência</h4>';
    h += '<div class="cfg-row"><div><div class="cfg-label">Modo escuro</div><div class="cfg-sub">Tema escuro em todo o app</div></div>';
    h += '<label class="switch"><input type="checkbox" id="cfg-dark" '+(settings.tema==='escuro'?'checked':'')+'/><span class="track"></span></label></div>';
    h += '</div>';

    h += '<div class="cfg-card"><h4>Segurança</h4>';
    h += '<input class="cfg-input" id="cfg-pin" type="password" inputmode="numeric" maxlength="8" placeholder="'+(settings.pin?'Senha definida — digite nova para trocar':'Definir senha de acesso (números)')+'"/>';
    h += '<button class="cfg-btn" id="cfg-save-pin">'+(settings.pin?'Trocar senha':'Ativar senha')+'</button>';
    if(settings.pin) h += '<button class="cfg-btn danger" id="cfg-remove-pin">Remover senha</button>';
    h += '</div>';

    h += '<div class="cfg-card"><h4>Backup e dados</h4>';
    h += '<button class="cfg-btn accent" id="cfg-backup">Exportar backup completo (.json)</button>';
    h += '<button class="cfg-btn" id="cfg-restore">Restaurar backup (.json)</button>';
    h += '<input type="file" id="cfg-restore-file" accept=".json,application/json" style="display:none"/>';
    h += '<button class="cfg-btn" id="cfg-excel">Exportar mês para Excel (.csv)</button>';
    h += '</div>';

    h += '<div class="cfg-card"><h4>Aplicativo</h4>';
    h += '<button class="cfg-btn" id="cfg-install-app">Instalar aplicativo</button>';
    h += '<button class="cfg-btn" id="cfg-sync-now">Sincronizar agora</button>';
    h += '</div>';

    h += '<div class="cfg-card"><h4>Conta</h4>';
    h += '<div class="cfg-sub" style="line-height:1.6;">'+escapeHTML(currentUser ? currentUser.email : '')+'<br/>Perfil: '+escapeHTML(currentProfile ? currentProfile.cargo : '')+'</div>';
    h += '<button class="cfg-btn danger" id="cfg-logout">Sair da conta</button>';
    h += '</div>';

    h += '<div class="cfg-card"><h4>Auditoria — últimas alterações</h4>';
    if(auditLog.length === 0){ h += '<div class="daily-empty">Nenhuma alteração registrada ainda.</div>'; }
    else {
      auditLog.slice(0,25).forEach(function(item){
        h += '<div class="audit-item"><b>'+escapeHTML(item.a)+'</b>'+escapeHTML(item.t)+'</div>';
      });
    }
    h += '</div>';

    // Módulos opcionais (apenas Administrador)
    if(canManageCompany()){
      h += '<div class="cfg-card"><h4>Módulos opcionais</h4>';
      h += '<div class="cfg-sub" style="margin-bottom:10px;">Ative ou desative funcionalidades extras por empresa. Apenas Administradores podem alterar.</div>';
      h += '<div class="cfg-row"><div><div class="cfg-label">Gestão de Motoboys</div><div class="cfg-sub">Motoboys, motoristas, lançamentos e relatórios de entregas</div></div>';
      h += '<label class="switch"><input type="checkbox" id="cfg-module-motoboys" '+(motoboysModuleActive?'checked':'')+'/><span class="track"></span></label></div>';
      h += '</div>';
    }

    h += '<div class="cfg-card"><h4>Sobre</h4><div class="cfg-sub" style="line-height:1.6;">Financeiro GM FLEX · v2.0<br/>Dados oficiais salvos no Supabase.<br/>Cache local mantido apenas para uso offline.</div></div>';

    h += '<div class="cfg-card cfg-credits"><h4>Créditos</h4><div class="cfg-sub" style="line-height:1.8;"><strong>Desenvolvedor</strong><br/>Gabriel Dorico de Oliveira<br/><br/><span style="font-size:10px;color:var(--muted);">Desenvolvido com dedicação e profissionalismo.</span></div></div>';

    h += '</main>';
    return h;
  }

  function doBackup(){
    var data = {
      versao: 2,
      geradoEm: new Date().toISOString(),
      entries: state.entries,
      customRates: (function(){ var ex={}; driverNames.forEach(function(n){ if(!DEFAULT_RATES[n]) ex[n]=RATES[n]; }); return ex; })(),
      settings: settings,
      audit: auditLog
    };
    var blob = new Blob([JSON.stringify(data, null, 1)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var d = new Date();
    a.download = 'Backup_GMFLEX_'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'.json';
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 3000);
    audit('backup','Backup exportado');
    toast('Backup exportado');
  }

  function doRestore(file){
    var reader = new FileReader();
    reader.onerror = function(){ toast('Não foi possível ler o backup'); };
    reader.onload = function(){
      try{
        var data = JSON.parse(reader.result);
        if(!data || typeof data !== 'object' || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) throw new Error('inválido');
        if(data.customRates && (typeof data.customRates !== 'object' || Array.isArray(data.customRates))) throw new Error('inválido');
        if(data.settings && (typeof data.settings !== 'object' || Array.isArray(data.settings))) throw new Error('inválido');
        state.entries = data.entries || {};
        if(data.customRates) RATES = Object.assign({}, DEFAULT_RATES, data.customRates);
        if(data.settings) settings = Object.assign(settings, data.settings);
        if(Array.isArray(data.audit)) auditLog = data.audit;
        refreshDriverNames();
        saveEntries(); saveRates(); saveSettings();
        try{ localStorage.setItem(AUDIT_KEY, JSON.stringify(auditLog)); }catch(e){}
        state.cfgMsg = 'Backup restaurado com sucesso!';
        render();
      }catch(e){
        state.cfgMsg = null;
        toast('Arquivo de backup inválido');
      }
    };
    reader.readAsText(file);
  }

  function doExcelExport(){
    var keys = monthDateKeys();
    var lines = ['Data;Transportadora;ML;SH;Valor ML;Valor SH;Total'];
    keys.forEach(function(k){
      driverNames.forEach(function(dr){
        var e = getDriverEntry(k, dr);
        if((e.ml||0)===0 && (e.sh||0)===0) return;
        var r = RATES[dr];
        var vml = (e.ml||0)*r.ml, vsh = (e.sh||0)*r.sh;
        lines.push(brDate(k)+';'+dr+';'+(e.ml||0)+';'+(e.sh||0)+';'+vml.toFixed(2).replace('.',',')+';'+vsh.toFixed(2).replace('.',',')+';'+(vml+vsh).toFixed(2).replace('.',','));
      });
    });
    var blob = new Blob(['\ufeff'+lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'GMFLEX_'+MONTH_NAMES[state.month-1]+'_'+state.year+'.csv';
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 3000);
    audit('excel','Exportação Excel — '+MONTH_NAMES[state.month-1]+'/'+state.year);
    toast('Planilha exportada');
  }

  function renderLancamento(){
    var h = '<main class="view-lancamento">' + renderCalendar() + renderDayPanel() + '</main>';
    h += renderFooterLanc();
    return h;
  }

  function renderCalendar(){
    var y = state.year, m = state.month, n = daysInMonth(y,m), start = firstWeekday(y,m), tISO = todayISO();
    var h = '<div class="cal-wrap"><div class="cal-weekdays">';
    WEEKDAY_SHORT.forEach(function(w){ h += '<span>'+w+'</span>'; });
    h += '</div><div class="cal-grid">';
    for(var i=0;i<start;i++) h += '<div class="cal-cell blank"></div>';
    for(var d=1; d<=n; d++){
      var key = isoDate(y,m,d), sun = isSunday(y,m,d), sel = key === state.selectedDate, isToday = key === tISO;
      var dayData = state.entries[key];
      var hasData = dayData && Object.keys(dayData).some(function(dr){ return dayData[dr] && ((dayData[dr].ml||0)>0 || (dayData[dr].sh||0)>0); });
      var cls = 'cal-cell'+(sun?' sunday':'')+(sel?' selected':'')+(isToday?' today':'');
      h += '<div class="'+cls+'" data-date="'+key+'"><span class="cnum">'+d+'</span>'+(hasData?'<span class="cdot"></span>':'')+'</div>';
    }
    h += '</div></div>';
    return h;
  }

  function renderDayPanel(){
    var key = state.selectedDate;
    var parts = key.split('-');
    var dObj = new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));
    var wd = WEEKDAY_FULL[dObj.getDay()];
    var sun = dObj.getDay() === 0;
    var label = wd+', '+parseInt(parts[2])+' de '+MONTH_NAMES[parseInt(parts[1])-1].toLowerCase();

    var h = '<div class="day-panel"><div class="day-title">'+label+'</div>';
    if(sun) h += '<div class="off-banner">☀️ Domingo — normalmente sem operação, mas você pode lançar se precisar.</div>';
    h += '<div class="subtabs">';
    h += '  <button class="subtab-btn '+(state.daySubTab==='coleta'?'active':'')+'" data-subtab="coleta">Coleta Diária</button>';
    h += '  <button class="subtab-btn '+(state.daySubTab==='entrada'?'active':'')+'" data-subtab="entrada">Entrada de Pacotes</button>';
    h += '</div>';

    if(state.daySubTab === 'coleta'){
      h += '<div class="searchbar-row">';
      h += '  <div class="searchbar">'+iconSearch()+'<input id="search-input" placeholder="Buscar transportadora..." value="'+escapeAttr(state.search)+'"/></div>';
      h += '  <button class="add-partner-btn" id="toggle-add-form">'+(state.showAddForm?'✕':'+')+'</button>';
      h += '</div>';
      if(state.showAddForm){
        h += '<div class="add-partner-card">';
        h += '  <h4>Nova transportadora parceira</h4>';
        h += '  <input id="new-partner-name" class="add-input" type="text" placeholder="Nome da transportadora" autocomplete="off"/>';
        h += '  <div class="add-rate-row">';
        h += '    <input id="new-partner-ml" class="add-input" type="text" inputmode="decimal" placeholder="Taxa ML (ex: 10)"/>';
        h += '    <input id="new-partner-sh" class="add-input" type="text" inputmode="decimal" placeholder="Taxa SH (ex: 7)"/>';
        h += '  </div>';
        if(state.addFormError) h += '  <div class="add-error">'+state.addFormError+'</div>';
        h += '  <button class="add-confirm-btn" id="confirm-add-partner">Adicionar transportadora</button>';
        h += '</div>';
      }
      var list = activeDriverNames.filter(function(n){ return n.toLowerCase().indexOf(state.search.toLowerCase()) !== -1; });
      if(list.length === 0){
        h += '<div class="empty-state">Nenhuma transportadora encontrada.</div>';
      } else {
        h += '<div class="driver-list">';
        list.forEach(function(dr){
          var r = RATES[dr]; var e = getDriverEntry(key, dr); var val = dayDriverValor(key, dr);
          h += '<div class="driver-row">';
          h += '  <div><div class="driver-name">'+escapeHTML(dr)+'</div><div class="driver-rate">ML R$'+r.ml.toFixed(2).replace('.',',')+' · SH R$'+r.sh.toFixed(2).replace('.',',')+'</div></div>';
          h += '  <div class="field"><label>ML</label><input type="number" min="0" step="1" inputmode="numeric" data-driver="'+escapeAttr(dr)+'" data-field="ml" value="'+(e.ml!==null&&e.ml!==undefined?e.ml:'')+'" placeholder="0"/></div>';
          h += '  <div class="field"><label>SH</label><input type="number" min="0" step="1" inputmode="numeric" data-driver="'+escapeAttr(dr)+'" data-field="sh" value="'+(e.sh!==null&&e.sh!==undefined?e.sh:'')+'" placeholder="0"/></div>';
          if(canManageRates()) h += '  <button class="driver-remove-btn" data-remove-driver="'+escapeAttr(dr)+'" title="Encerrar parceria / remover transportadora">✕</button>';
          h += '  <div class="row-value">valor do dia: <b>'+money(val)+'</b></div>';
          h += '</div>';
        });
        h += '</div>';
      }
      if(canManageRates()){
        var inactiveList = driverNames.filter(function(n){ return !isActiveRate(n); });
        if(inactiveList.length){
          h += '<div class="inactive-toggle-row"><button class="inactive-toggle-btn" id="toggle-inactive-partners">'+(state.showInactive?'▾':'▸')+' Transportadoras inativas ('+inactiveList.length+')</button></div>';
          if(state.showInactive){
            h += '<div class="driver-list inactive-list">';
            inactiveList.forEach(function(dr){
              var r = RATES[dr];
              h += '<div class="driver-row driver-row-inactive">';
              h += '  <div><div class="driver-name">'+escapeHTML(dr)+'</div><div class="driver-rate">ML R$'+r.ml.toFixed(2).replace('.',',')+' · SH R$'+r.sh.toFixed(2).replace('.',',')+' · inativa</div></div>';
              h += '  <button class="driver-reactivate-btn" data-reactivate-driver="'+escapeAttr(dr)+'">Reativar</button>';
              h += '</div>';
            });
            h += '</div>';
          }
        }
      }
    } else {
      var lr = dayLucroLiquido(key);
      var ent = lr.ent;
      h += '<div class="auto-card"><h4>Entrada de pacotes — calculado automaticamente</h4>';
      h += '  <div class="auto-note">Soma do ML e SH lançados em "Coleta Diária" acima, valorizado pela taxa de cada transportadora parceira (mesma base do "A Receber").</div>';
      h += '  <div class="auto-grid">';
      h += '    <div class="auto-metric"><div class="alabel">Qtd. ML</div><div class="aval">'+ent.qtdML+'</div></div>';
      h += '    <div class="auto-metric"><div class="alabel">Qtd. SH</div><div class="aval">'+ent.qtdSH+'</div></div>';
      h += '    <div class="auto-metric"><div class="alabel">Valor Entrada ML</div><div class="aval">'+money(ent.valorML)+'</div></div>';
      h += '    <div class="auto-metric"><div class="alabel">Valor Entrada SH</div><div class="aval">'+money(ent.valorSH)+'</div></div>';
      h += '  </div>';
      h += '  <div class="base-value">valor total de entrada: <b>'+money(ent.total)+'</b></div>';
      h += '</div>';

      if(motoboysModuleActive){
        h += '<div class="auto-card"><h4>Motoboys e motoristas — módulo Motoboys</h4>';
        h += '  <div class="auto-note">Pago aos motoboys e diárias de motoristas lançados no dia, no módulo Motoboys.</div>';
        h += '  <div class="auto-grid">';
        h += '    <div class="auto-metric"><div class="alabel">Pago Motoboys</div><div class="aval">'+money(lr.totalMotoboys)+'</div></div>';
        h += '    <div class="auto-metric"><div class="alabel">Diárias Motoristas</div><div class="aval">'+money(lr.totalDiarias)+'</div></div>';
        h += '  </div>';
        h += '  <div class="base-value">custo motoboys do dia: <b>'+money(lr.totalMotoboys+lr.totalDiarias)+'</b></div>';
        h += '</div>';
      }

      h += '<div class="auto-card" style="background:#FBDAD6;"><h4>Lucro Líquido do Dia</h4>';
      h += '  <div class="auto-note" style="margin-bottom:2px;">'+(motoboysModuleActive?'Entrada − Pago Motoboys − Diárias':'Entrada')+'</div>';
      h += '  <div class="base-value" style="border:none; padding-top:2px;"><b style="font-size:19px;">'+money(lr.lucroLiquido)+'</b></div>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function renderFooterLanc(){
    var key = state.selectedDate;
    var h = '<div class="footer-bar">';
    if(state.daySubTab === 'coleta'){
      var pct=0; driverNames.forEach(function(dr){ var e=getDriverEntry(key,dr); pct += (e.ml||0)+(e.sh||0); });
      h += '  <div class="footer-metric"><div class="flabel">Pacotes (coleta)</div><div class="fval">'+pct+'</div></div>';
      h += '  <div class="footer-metric money"><div class="flabel">A pagar no dia</div><div class="fval">'+money(dayReceber(key))+'</div></div>';
    } else {
      var lr = dayLucroLiquido(key);
      h += '  <div class="footer-metric"><div class="flabel">Entrada total</div><div class="fval">'+money(lr.ent.total)+'</div></div>';
      h += '  <div class="footer-metric money"><div class="flabel">Lucro Líquido</div><div class="fval">'+money(lr.lucroLiquido)+'</div></div>';
    }
    h += '  <div class="save-chip"><span class="save-dot"></span><span id="save-chip-text">salvo</span></div></div>';
    return h;
  }

  function renderFechamento(){
    var keys = monthDateKeys();
    var driverTotals = driverNames.map(function(dr){
      var r = RATES[dr]; var mlQ=0, shQ=0;
      keys.forEach(function(k){ var e = getDriverEntry(k, dr); mlQ += (e.ml||0); shQ += (e.sh||0); });
      var mlVal = mlQ*r.ml, shVal = shQ*r.sh;
      return {name:dr, mlQ:mlQ, shQ:shQ, mlVal:mlVal, shVal:shVal, total:mlVal+shVal};
    }).sort(function(a,b){ return b.total - a.total; });

    var monthTot = rangeTotals(keys);
    var q1 = rangeTotals(quinzenaKeys(1));
    var q2 = rangeTotals(quinzenaKeys(2));
    var maxVal = Math.max.apply(null, driverTotals.map(function(t){return t.total;}).concat([1]));
    var grandML = driverTotals.reduce(function(s,t){return s+t.mlQ;},0);
    var grandSH = driverTotals.reduce(function(s,t){return s+t.shQ;},0);

    var h = '<main class="view-fechamento">';
    h += '<button class="pdf-btn" id="gen-pdf-btn">'+iconPDF()+' Gerar Relatório em PDF</button>';

    h += '<div class="resumo-grid">';
    h += '  <div class="resumo-card"><div class="rlabel">A Receber (Transportadoras)</div><div class="rval">'+money(monthTot.receber)+'</div></div>';
    h += '  <div class="resumo-card"><div class="rlabel">Motoboys + Diárias</div><div class="rval">'+money(monthTot.custos)+'</div></div>';
    h += '  <div class="resumo-card lucro"><div class="rlabel">Lucro Líquido do Mês</div><div class="rval">'+money(monthTot.lucro)+'</div></div>';
    h += '</div>';

    h += '<div class="section-title">Lucro por Quinzena</div>';
    h += '<div class="quinzena-grid">';
    [['1ª Quinzena (1–15)',q1],['2ª Quinzena (16–fim)',q2]].forEach(function(pair){
      h += '<div class="qz-card"><div class="qtitle">'+pair[0]+'</div>';
      h += '  <div class="qz-line"><span>A Receber</span><span>'+money(pair[1].receber)+'</span></div>';
      h += '  <div class="qz-line"><span>Motoboys + Diárias</span><span>'+money(pair[1].custos)+'</span></div>';
      h += '  <div class="qz-line lucro"><span>Lucro</span><span>'+money(pair[1].lucro)+'</span></div>';
      h += '</div>';
    });
    h += '</div>';

    h += '<div class="section-title">Entrada de Pacotes por Quinzena</div>';
    [['1ª Quinzena (1–15)',quinzenaKeys(1)],['2ª Quinzena (16–fim)',quinzenaKeys(2)]].forEach(function(pair){
      var qkeys = pair[1].filter(function(k){ return dayEntradaValor(k).total > 0; });
      h += '<div class="entrada-qz-block"><div class="entrada-qz-title">'+pair[0]+'</div>';
      if(qkeys.length === 0){
        h += '<div class="daily-empty">Sem entrada registrada.</div>';
      } else {
        var qzTotal = 0;
        qkeys.forEach(function(k){
          var ent = dayEntradaValor(k);
          qzTotal += ent.total;
          h += '<div class="entrada-row"><span class="edate">'+brDate(k)+'</span><span class="eval">'+money(ent.total)+'</span></div>';
        });
        h += '<div class="entrada-qz-total"><span>Total da quinzena</span><span>'+money(qzTotal)+'</span></div>';
      }
      h += '</div>';
    });

    h += '<div class="section-title">Ranking de Transportadoras Parceiras <span class="stag">'+grandML+' ML · '+grandSH+' SH</span></div>';
    var anyDriverData = driverTotals.some(function(t){return t.total>0;});
    if(!anyDriverData){
      h += '<div class="empty-state">Nenhum lançamento neste mês ainda.</div>';
    } else {
      driverTotals.forEach(function(t,i){
        if(t.mlQ===0 && t.shQ===0) return;
        var w = maxVal>0 ? Math.round((t.total/maxVal)*100) : 0;
        var expanded = state.expandedFechDriver === t.name;
        h += '<div class="fech-row" data-driver-toggle="'+escapeAttr(t.name)+'"><div class="fech-bar" style="width:'+w+'%"></div><div class="fech-content">';
        h += '  <div class="fech-top"><div class="fech-name"><span class="fech-rank">'+String(i+1).padStart(2,'0')+'</span>'+escapeHTML(t.name)+'</div><div class="fech-total">'+money(t.total)+'</div></div>';
        h += '  <div class="fech-split"><span>ML <b>'+t.mlQ+'</b> · '+money(t.mlVal)+'</span><span>SH <b>'+t.shQ+'</b> · '+money(t.shVal)+'</span></div>';
        h += '  <div class="fech-pdf-hint">'+(expanded?'▾ contagem de pacotes por dia':'▸ toque para ver a contagem de pacotes por dia')+'</div>';
        if(expanded) h += _renderFechDriverDaily(t.name, keys);
        h += '</div></div>';
      });
    }

    h += '<div class="section-title">Lucro por Dia <span class="stag">entrada'+(motoboysModuleActive?' − motoboys − diárias':'')+'</span></div>';
    var anyDay = keys.some(function(k){ return dayEntradaValor(k).total>0; });
    if(!anyDay){
      h += '<div class="daily-empty">Sem lançamentos neste mês.</div>';
    } else {
      keys.forEach(function(k){
        var lr = dayLucroLiquido(k);
        var ent = lr.ent, lucro = lr.lucroLiquido;
        if(ent.total===0) return;
        h += '<div class="daily-row"><div class="daily-top"><div class="daily-date">'+brDate(k)+'</div><div class="daily-total '+(lucro>=0?'pos':'neg')+'">'+money(lucro)+'</div></div>';
        h += '<div class="daily-split"><span>Entrada ML <b>'+money(ent.valorML)+'</b></span><span>Entrada SH <b>'+money(ent.valorSH)+'</b></span><span>Total <b>'+money(ent.total)+'</b></span>'+((motoboysModuleActive && (lr.totalMotoboys>0 || lr.totalDiarias>0))?'<span>Motoboys <b>'+money(lr.totalMotoboys)+'</b></span><span>Diárias <b>'+money(lr.totalDiarias)+'</b></span>':'')+'</div></div>';
      });
    }

    h += '</main>';
    return h;
  }

  var barChartInstance = null, lineChartInstance = null;

  function renderDashboard(){
    var keys = monthDateKeys();
    var mt = rangeTotals(keys);
    var q1 = rangeTotals(quinzenaKeys(1)), q2 = rangeTotals(quinzenaKeys(2));

    var driverTotals = driverNames.map(function(dr){
      var r = RATES[dr]; var mlQ=0, shQ=0;
      keys.forEach(function(k){ var e = getDriverEntry(k, dr); mlQ += (e.ml||0); shQ += (e.sh||0); });
      return {name:dr, total: mlQ*r.ml + shQ*r.sh};
    }).filter(function(t){ return t.total>0; }).sort(function(a,b){ return b.total-a.total; });

    var anyData = driverTotals.length > 0;

    var h = '<main class="view-dashboard">';
    h += '<div class="kpi-grid">';
    h += '  <div class="kpi-card"><div class="klabel">A Receber</div><div class="kval">'+money(mt.receber)+'</div></div>';
    h += '  <div class="kpi-card"><div class="klabel">Motoboys + Diárias</div><div class="kval">'+money(mt.custos)+'</div></div>';
    h += '  <div class="kpi-card"><div class="klabel">1ª Quinzena — Lucro</div><div class="kval">'+money(q1.lucro)+'</div></div>';
    h += '  <div class="kpi-card"><div class="klabel">2ª Quinzena — Lucro</div><div class="kval">'+money(q2.lucro)+'</div></div>';
    h += '  <div class="kpi-card full"><div class="klabel">Lucro Líquido do Mês</div><div class="kval">'+money(mt.lucro)+'</div></div>';
    h += '</div>';

    h += '<div class="chart-card"><h4>Ranking de Transportadoras Parceiras (Top 10 por valor)</h4>';
    h += anyData ? '<div class="chart-box tall"><canvas id="chart-bar"></canvas></div>' : '<div class="chart-empty">Sem lançamentos neste mês ainda.</div>';
    h += '</div>';

    h += '<div class="chart-card"><h4>Lucro por Dia</h4>';
    h += anyData ? '<div class="chart-box"><canvas id="chart-line"></canvas></div>' : '<div class="chart-empty">Sem lançamentos neste mês ainda.</div>';
    h += '</div>';

    h += '</main>';
    return h;
  }

  function initDashboardCharts(){
    if(!window.Chart) return;
    var keys = monthDateKeys();

    if(barChartInstance){ barChartInstance.destroy(); barChartInstance = null; }
    if(lineChartInstance){ lineChartInstance.destroy(); lineChartInstance = null; }

    var driverTotals = driverNames.map(function(dr){
      var r = RATES[dr]; var mlQ=0, shQ=0;
      keys.forEach(function(k){ var e = getDriverEntry(k, dr); mlQ += (e.ml||0); shQ += (e.sh||0); });
      return {name:dr, total: mlQ*r.ml + shQ*r.sh};
    }).filter(function(t){ return t.total>0; }).sort(function(a,b){ return b.total-a.total; }).slice(0,10);

    var barCanvas = document.getElementById('chart-bar');
    if(barCanvas && driverTotals.length){
      barChartInstance = new Chart(barCanvas.getContext('2d'), {
        type:'bar',
        data:{
          labels: driverTotals.map(function(t){return t.name;}),
          datasets:[{
            data: driverTotals.map(function(t){return t.total;}),
            backgroundColor:'#E2231A', borderRadius:5, maxBarThickness:26
          }]
        },
        options:{
          indexAxis:'y', responsive:true, maintainAspectRatio:false,
          plugins:{legend:{display:false}, tooltip:{callbacks:{label:function(ctx){return money(ctx.raw);}}}},
          scales:{ x:{ ticks:{ callback:function(v){return 'R$ '+v;}, font:{size:9} }, grid:{color:'#EEEAE0'} },
                   y:{ ticks:{font:{size:10, weight:'bold'}}, grid:{display:false} } }
        }
      });
    }

    var lineCanvas = document.getElementById('chart-line');
    if(lineCanvas && driverTotals.length){
      var labels = [], values = [];
      keys.forEach(function(k){
        var lr = dayLucroLiquido(k);
        if(lr.ent.total===0) return;
        labels.push(brDateShort(k));
        values.push(lr.lucroLiquido);
      });
      lineChartInstance = new Chart(lineCanvas.getContext('2d'), {
        type:'line',
        data:{ labels:labels, datasets:[{
          data: values, borderColor:'#17171A', backgroundColor:'rgba(226,35,26,0.15)',
          fill:true, tension:0.3, pointBackgroundColor:'#E2231A', pointRadius:3.5, borderWidth:2
        }]},
        options:{
          responsive:true, maintainAspectRatio:false,
          plugins:{legend:{display:false}, tooltip:{callbacks:{label:function(ctx){return money(ctx.raw);}}}},
          scales:{ x:{ ticks:{font:{size:9}}, grid:{display:false} },
                   y:{ ticks:{ callback:function(v){return 'R$ '+v;}, font:{size:9} }, grid:{color:'#EEEAE0'} } }
        }
      });
    }
  }

  function bindEvents(){
    // ─── Menu Sidebar Recolhível ───
    var menuToggleBtn = document.getElementById('menu-toggle-btn');
    var sidebarCloseBtn = document.getElementById('sidebar-close-btn');
    var sidebarOverlay = document.getElementById('sidebar-overlay');
    
    if(menuToggleBtn){
      menuToggleBtn.addEventListener('click', function(){ state.sidebarOpen = !state.sidebarOpen; render(); });
    }
    if(sidebarCloseBtn){
      sidebarCloseBtn.addEventListener('click', function(){ state.sidebarOpen = false; render(); });
    }
    if(sidebarOverlay){
      sidebarOverlay.addEventListener('click', function(){ state.sidebarOpen = false; render(); });
    }
    
    // Navegação entre abas: troca a aba imediatamente (render local) e, ao SAIR da aba
    // Módulo Motoboys, recarrega os custos de Motoboys/Diárias do mês (state.motoboyCostsByDay).
    // Sem isso, lançamentos feitos no Módulo Motoboys (valor do motoboy, motorista da diária
    // etc.) não apareciam atualizados em "Entrada de Pacotes", "Fechamento" e "Dashboard" até
    // a próxima troca de mês ou recarregamento da página — pois esses dados vivem em um cache
    // separado (state.motoboyCostsByDay) do estado interno do módulo Motoboys.
    function goToTab(tab){
      var previousTab = state.tab;
      state.tab = tab;
      state.sidebarOpen = false;
      render();
      if(previousTab === 'motoboys' && tab !== 'motoboys' && motoboysModuleActive && currentCompanyId && navigator.onLine){
        loadRemoteMotoboyCostsForCurrentMonth().then(function(){ render(); });
      }
    }

    // Navegação via Sidebar (novo menu lateral)
    document.querySelectorAll('.sidebar-item').forEach(function(btn){
      btn.addEventListener('click', function(){ 
        goToTab(btn.getAttribute('data-tab')); 
      });
    });

    // Navegação via Bottom Nav (mantido por compatibilidade em alguns contextos)
    document.querySelectorAll('.bnav-item').forEach(function(btn){
      btn.addEventListener('click', function(){ goToTab(btn.getAttribute('data-tab')); });
    });

    var el;
    el = document.getElementById('cfg-save-empresa');
    if(el) el.addEventListener('click', function(){
      settings.empresa = document.getElementById('cfg-empresa').value.trim() || 'FINANCEIRO GM FLEX';
      settings.responsavel = document.getElementById('cfg-resp').value.trim();
      settings.telefone = document.getElementById('cfg-tel').value.trim();
      settings.email = document.getElementById('cfg-email').value.trim();
      saveSettings(); audit('cfg','Dados da empresa atualizados');
      state.cfgMsg = 'Dados salvos!'; render();
    });
    el = document.getElementById('cfg-dark');
    if(el) el.addEventListener('change', function(){
      settings.tema = el.checked ? 'escuro' : 'claro';
      saveSettings(); applyTheme(); audit('tema','Tema alterado para '+settings.tema);
    });
    el = document.getElementById('cfg-save-pin');
    if(el) el.addEventListener('click', function(){
      var v = document.getElementById('cfg-pin').value.trim();
      if(!v || v.length < 4){ toast('A senha precisa ter pelo menos 4 números'); return; }
      settings.pin = v; saveSettings(); audit('pin','Senha de acesso definida/alterada');
      state.cfgMsg = 'Senha ativada!'; render();
    });
    el = document.getElementById('cfg-remove-pin');
    if(el) el.addEventListener('click', function(){
      settings.pin = ''; saveSettings(); audit('pin','Senha de acesso removida');
      state.cfgMsg = 'Senha removida.'; render();
    });
    el = document.getElementById('cfg-backup');
    if(el) el.addEventListener('click', doBackup);
    el = document.getElementById('cfg-excel');
    if(el) el.addEventListener('click', doExcelExport);
    el = document.getElementById('cfg-sync-now');
    if(el) el.addEventListener('click', function(){ refreshRemoteData().then(function(){ toast('Sincronizado!'); }); });
    el = document.getElementById('cfg-install-app');
    if(el) el.addEventListener('click', function(){
      if(window.GMFLEXPWA && window.GMFLEXPWA.install){
        window.GMFLEXPWA.install().then(function(result){ toast(result.message); });
      } else {
        toast('Instalação indisponível neste navegador');
      }
    });
    el = document.getElementById('cfg-restore');
    if(el) el.addEventListener('click', function(){ document.getElementById('cfg-restore-file').click(); });
    el = document.getElementById('cfg-restore-file');
    if(el) el.addEventListener('change', function(){ if(el.files && el.files[0]) doRestore(el.files[0]); });
    el = document.getElementById('cfg-logout');
    if(el) el.addEventListener('click', function(){
      if(window.confirm('Deseja realmente sair da sua conta?')) doLogout();
    });
    document.querySelectorAll('[data-nav]').forEach(function(btn){
      btn.addEventListener('click', function(){ changeMonth(parseInt(btn.getAttribute('data-nav'),10)); });
    });
    document.querySelectorAll('.cal-cell[data-date]').forEach(function(cell){
      cell.addEventListener('click', function(){ state.selectedDate = cell.getAttribute('data-date'); render(); });
    });
    document.querySelectorAll('.subtab-btn').forEach(function(btn){
      btn.addEventListener('click', function(){ state.daySubTab = btn.getAttribute('data-subtab'); render(); });
    });
    var search = document.getElementById('search-input');
    if(search){
      search.addEventListener('input', function(){
        state.search = search.value; render();
        var again = document.getElementById('search-input');
        if(again){ again.focus(); var val = again.value; again.value=''; again.value = val; }
      });
    }
    var toggleAdd = document.getElementById('toggle-add-form');
    if(toggleAdd){
      toggleAdd.addEventListener('click', function(){
        state.showAddForm = !state.showAddForm;
        state.addFormError = null;
        render();
      });
    }
    var confirmAdd = document.getElementById('confirm-add-partner');
    if(confirmAdd){
      confirmAdd.addEventListener('click', function(){
        var nameEl = document.getElementById('new-partner-name');
        var mlEl = document.getElementById('new-partner-ml');
        var shEl = document.getElementById('new-partner-sh');
        var result = addCustomPartner(nameEl.value, mlEl.value, shEl.value);
        if(!result.ok){
          state.addFormError = result.msg;
          render();
        } else {
          state.showAddForm = false;
          state.addFormError = null;
          state.search = '';
          render();
        }
      });
    }
    var toggleInactive = document.getElementById('toggle-inactive-partners');
    if(toggleInactive){
      toggleInactive.addEventListener('click', function(){
        state.showInactive = !state.showInactive;
        render();
      });
    }
    document.querySelectorAll('[data-remove-driver]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var name = btn.getAttribute('data-remove-driver');
        var confirmed = window.confirm('Encerrar a parceria com "'+name+'"?\n\nEla deixará de aparecer para novos lançamentos, mas os lançamentos e relatórios já registrados serão mantidos. É possível reativá-la depois.');
        if(!confirmed) return;
        removePartner(name).then(function(result){
          if(!result.ok){ toast(result.msg); return; }
          toast(result.mode === 'deleted' ? 'Transportadora excluída.' : 'Transportadora removida da lista.');
          render();
        });
      });
    });
    document.querySelectorAll('[data-reactivate-driver]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var name = btn.getAttribute('data-reactivate-driver');
        var result = reactivatePartner(name);
        if(!result.ok){ toast(result.msg); return; }
        toast('Transportadora reativada.');
        render();
      });
    });
    document.querySelectorAll('.driver-row input').forEach(function(inp){
      inp.addEventListener('input', function(){
        var driver = inp.getAttribute('data-driver'), field = inp.getAttribute('data-field');
        setDriverField(state.selectedDate, driver, field, inp.value);
        var val = dayDriverValor(state.selectedDate, driver);
        var row = inp.closest('.driver-row'); var rv = row.querySelector('.row-value b');
        if(rv) rv.textContent = money(val);
        var pct=0; driverNames.forEach(function(dr){ var e=getDriverEntry(state.selectedDate,dr); pct += (e.ml||0)+(e.sh||0); });
        var fv = document.querySelectorAll('.footer-metric .fval');
        if(fv[0]) fv[0].textContent = pct;
        if(fv[1]) fv[1].textContent = money(dayReceber(state.selectedDate));
        var cell = document.querySelector('.cal-cell[data-date="'+state.selectedDate+'"]');
        if(cell && !cell.querySelector('.cdot') && pct>0){ var dot=document.createElement('span'); dot.className='cdot'; cell.appendChild(dot); }
      });
    });
    // Módulo Motoboys — toggle na tela de Ajustes
    el = document.getElementById('cfg-module-motoboys');
    if(el) el.addEventListener('change', async function(){
      if(!window.GMFLEX.motoboysRepository) return;
      var enabled = el.checked;
      var result = await window.GMFLEX.motoboysRepository.setModuleEnabled(currentCompanyId, 'motoboys', enabled);
      if(result.error){ toast(friendlyError(result.error)); el.checked = !enabled; return; }
      motoboysModuleActive = enabled;
      companyModules['motoboys'] = enabled;
      if(!enabled && state.tab === 'motoboys') state.tab = 'lanc';
      if(enabled) motoboysModuleInitialized = false; // força reinicialização
      audit('mod:motoboys', 'Módulo Motoboys '+(enabled?'ativado':'desativado'));
      state.cfgMsg = 'Módulo '+(enabled?'ativado':'desativado')+'!';
      if(enabled){
        // Módulo ligado: busca os custos de motoboys/diárias do mês para já refletir no Lucro Líquido
        loadRemoteMotoboyCostsForCurrentMonth().then(function(){ render(); });
      } else {
        // Módulo desligado: zera o cache — Lucro Líquido do dia volta a ser só a Entrada
        state.motoboyCostsByDay = {};
      }
      render();
    });

    // Módulo Motoboys — bind de eventos da view
    if(state.tab === 'motoboys' && motoboysModuleActive && window.GMFLEX.motoboysModule){
      var mbContainer = document.querySelector('.mb-module');
      if(mbContainer) window.GMFLEX.motoboysModule.bindEvents(mbContainer);
    }

    var pdfBtn = document.getElementById('gen-pdf-btn');
    if(pdfBtn) pdfBtn.addEventListener('click', generatePDF);
    document.querySelectorAll('.fech-row[data-driver-toggle]').forEach(function(row){
      row.addEventListener('click', function(){
        var name = row.getAttribute('data-driver-toggle');
        state.expandedFechDriver = (state.expandedFechDriver === name) ? null : name;
        render();
      });
    });
    document.querySelectorAll('.fech-gen-pdf-btn[data-driver-pdf]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        generateDriverPDF(btn.getAttribute('data-driver-pdf'));
      });
    });
  }

  // ---------------- PDF REPORT ----------------
  function generatePDF(){
    if(!window.jspdf){ alert('Biblioteca de PDF ainda carregando, tente novamente em instantes.'); return; }
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({unit:'pt', format:'a4'});
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 42;
    var y = margin;

    function checkPage(need){ if(y + need > pageH - margin){ doc.addPage(); y = margin; } }
    function title(t){ checkPage(26); doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(20,20,20); doc.text(t, margin, y); y += 22; }
    function subtitle(t){ checkPage(18); doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(100,100,100); doc.text(t, margin, y); y += 16; }
    function sectionHeader(t){
      checkPage(24); y += 6;
      doc.setFillColor(23,23,26); doc.rect(margin, y-11, pageW-2*margin, 18, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(255,199,44);
      doc.text(t.toUpperCase(), margin+8, y+2); y += 18;
    }
    function kvRow(label, value, bold){
      checkPage(16);
      doc.setFont('helvetica', bold?'bold':'normal'); doc.setFontSize(10.5); doc.setTextColor(20,20,20);
      doc.text(label, margin+4, y);
      doc.text(value, pageW-margin-4, y, {align:'right'});
      y += 15;
    }
    function tableHeader(cols, widths){
      checkPage(18);
      doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(255,255,255);
      doc.setFillColor(60,60,64); doc.rect(margin, y-10, pageW-2*margin, 16, 'F');
      var x = margin+4;
      cols.forEach(function(c,i){ doc.text(c, x, y); x += widths[i]; });
      y += 13;
    }
    function tableRow(cols, widths, shaded){
      checkPage(14);
      if(shaded){ doc.setFillColor(245,244,239); doc.rect(margin, y-9, pageW-2*margin, 14, 'F'); }
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(30,30,30);
      var x = margin+4;
      cols.forEach(function(c,i){ doc.text(String(c), x, y); x += widths[i]; });
      y += 13;
    }

    var monthLabel = MONTH_NAMES[state.month-1]+' de '+state.year;
    var keys = monthDateKeys();
    var q1 = quinzenaKeys(1), q2 = quinzenaKeys(2);
    var q1t = rangeTotals(q1), q2t = rangeTotals(q2), mt = rangeTotals(keys);

    title('FINANCEIRO GM FLEX — Relatório de Fechamento');
    subtitle('Período: '+monthLabel+'  ·  Gerado em '+new Date().toLocaleDateString('pt-BR'));
    y += 4;

    sectionHeader('Resumo do Mês');
    kvRow('A Receber (Transportadoras)', money(mt.receber));
    kvRow('Motoboys + Diárias', money(mt.custos));
    kvRow('Lucro Líquido do Mês', money(mt.lucro), true);

    sectionHeader('Lucro por Quinzena');
    kvRow('1ª Quinzena (dias 1–15) — A Receber', money(q1t.receber));
    kvRow('1ª Quinzena — Motoboys + Diárias', money(q1t.custos));
    kvRow('1ª Quinzena — Lucro', money(q1t.lucro), true);
    y += 4;
    kvRow('2ª Quinzena (dia 16–fim) — A Receber', money(q2t.receber));
    kvRow('2ª Quinzena — Motoboys + Diárias', money(q2t.custos));
    kvRow('2ª Quinzena — Lucro', money(q2t.lucro), true);

    sectionHeader('Lucro por Dia — Detalhado (Entrada ML/SH'+(motoboysModuleActive?', Motoboys/Diárias':'')+', Lucro Líquido)');
    var colsW = [55,75,75,90,90,90];
    tableHeader(['Data','Entrada ML','Entrada SH','Total Entrada', motoboysModuleActive?'Motoboys+Diárias':'Custos', motoboysModuleActive?'Lucro Líquido R$':'Lucro R$'], colsW);
    keys.forEach(function(k,idx){
      var lr = dayLucroLiquido(k);
      if(lr.ent.total===0) return;
      tableRow([brDate(k), money(lr.ent.valorML), money(lr.ent.valorSH), money(lr.ent.total), money(lr.totalMotoboys+lr.totalDiarias), money(lr.lucroLiquido)], colsW, idx%2===0);
    });

    sectionHeader('Detalhamento por Transportadora Parceira (ML / SH / Valores)');
    var colsW2 = [110,50,50,95,95,95];
    tableHeader(['Transportadora','ML','SH','Valor ML','Valor SH','Total R$'], colsW2);
    var driverTotals = driverNames.map(function(dr){
      var r = RATES[dr]; var mlQ=0, shQ=0;
      keys.forEach(function(k){ var e = getDriverEntry(k, dr); mlQ += (e.ml||0); shQ += (e.sh||0); });
      return {name:dr, mlQ:mlQ, shQ:shQ, mlVal:mlQ*r.ml, shVal:shQ*r.sh, total:mlQ*r.ml+shQ*r.sh};
    }).sort(function(a,b){return b.total-a.total;});
    driverTotals.forEach(function(t,idx){
      if(t.mlQ===0 && t.shQ===0) return;
      tableRow([t.name, t.mlQ, t.shQ, money(t.mlVal), money(t.shVal), money(t.total)], colsW2, idx%2===0);
    });
    y += 6;
    checkPage(18);
    doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text('TOTAL GERAL: '+money(mt.receber), margin+4, y);
    y += 20;

    doc.save('Financeiro_GM_FLEX_'+MONTH_NAMES[state.month-1]+'_'+state.year+'.pdf');
  }

  function isSundayISO(iso){ var p=iso.split('-'); return isSunday(parseInt(p[0],10),parseInt(p[1],10),parseInt(p[2],10)); }
  function brDateShort(iso){ var p=iso.split('-'); return p[2]+'/'+p[1]; }
  function brDateShortYear(iso){ var p=iso.split('-'); return p[2]+'/'+p[1]+'/'+p[0].slice(2); }
  function fmt2(n){ return n.toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2}); }

  // Contagem diária de pacotes (ML/SH) de uma transportadora — exibida ao expandir
  // a linha dela no Ranking do Fechamento. Ex.: "dia 09/07/26 — 30 ML e 25 SH · R$ 275,00"
  function _renderFechDriverDaily(driverName, keys){
    var r = RATES[driverName];
    var rows = keys.map(function(k){
      var e = getDriverEntry(k, driverName);
      var ml = e.ml||0, sh = e.sh||0;
      if(ml===0 && sh===0) return null;
      var val = ml*r.ml + sh*r.sh;
      return { key:k, ml:ml, sh:sh, val:val };
    }).filter(Boolean);

    var h = '<div class="fech-daily-panel">';
    if(rows.length === 0){
      h += '<div class="fech-daily-empty">Nenhum pacote lançado para esta transportadora neste mês.</div>';
    } else {
      rows.forEach(function(row){
        h += '<div class="fech-daily-row">';
        h += '  <span class="fech-daily-date">dia '+brDateShortYear(row.key)+'</span>';
        h += '  <span class="fech-daily-qtd">'+row.ml+' ML e '+row.sh+' SH</span>';
        h += '  <span class="fech-daily-val">'+money(row.val)+'</span>';
        h += '</div>';
      });
    }
    h += '<button class="fech-gen-pdf-btn" data-driver-pdf="'+escapeAttr(driverName)+'">'+iconPDF()+' Gerar PDF completo desta transportadora</button>';
    h += '</div>';
    return h;
  }

  function generateDriverPDF(driverName){
    if(!window.jspdf){ alert('Biblioteca de PDF ainda carregando, tente novamente em instantes.'); return; }
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({unit:'pt', format:'a4'});
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 40;
    var y = margin;
    var r = RATES[driverName];

    function checkPage(need){ if(y + need > pageH - margin){ doc.addPage(); y = margin; } }

    function quinzenaSection(which, label){
      var keys = quinzenaKeys(which);
      if(keys.length === 0) return;
      checkPage(80);

      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 20, 'F');
      doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(11);
      doc.text('GM FLEX  –  PARCEIRO: '+driverName, pageW/2, y+14, {align:'center'});
      y += 20;

      doc.setFillColor(43,74,110);
      doc.rect(margin, y, pageW-2*margin, 18, 'F');
      doc.setFontSize(9.5);
      doc.text('CONTROLE DIÁRIO DE ENTREGAS  –  '+label+' '+MONTH_NAMES[state.month-1].toUpperCase()+'/'+state.year, pageW/2, y+12.5, {align:'center'});
      y += 26;

      var halfW = (pageW-2*margin)/2;
      doc.setFillColor(228,235,242); doc.setDrawColor(178,190,202);
      doc.rect(margin, y, halfW, 17, 'FD');
      doc.rect(margin+halfW, y, halfW, 17, 'FD');
      doc.setTextColor(20,20,20); doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
      doc.text('TAXA ML:  '+fmt2(r.ml), margin+8, y+11.5);
      doc.text('TAXA SH:  '+fmt2(r.sh), margin+halfW+8, y+11.5);
      y += 23;

      var cols = ['DATA','SAÍDA ML','SAÍDA SH','VALOR ML','VALOR SH','TOTAL'];
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
        var e = getDriverEntry(k, driverName);
        var sun = isSundayISO(k);
        var isOff = sun && (e.ml===null || e.ml===undefined) && (e.sh===null || e.sh===undefined);
        doc.setFillColor(idx%2===0?255:247, idx%2===0?255:246, idx%2===0?255:241);
        doc.rect(margin, y, pageW-2*margin, 15, 'F');
        doc.setDrawColor(228,226,218); doc.rect(margin, y, pageW-2*margin, 15);
        doc.setTextColor(30,30,30); doc.setFont('helvetica','normal'); doc.setFontSize(8);
        var xx = margin;
        doc.text(brDateShort(k), xx+widths[0]/2, y+10, {align:'center'}); xx += widths[0];
        if(isOff){
          doc.setFont('helvetica','bold');
          doc.text('DOMINGO', xx+5, y+10);
          xx += widths[1]+widths[2];
          doc.setFont('helvetica','normal');
          doc.text('R$   -', xx+widths[3]/2, y+10, {align:'center'}); xx += widths[3];
          doc.text('R$   -', xx+widths[4]/2, y+10, {align:'center'}); xx += widths[4];
          doc.text('R$   -', xx+widths[5]/2, y+10, {align:'center'});
        } else {
          var ml = e.ml||0, sh = e.sh||0, vml = ml*r.ml, vsh = sh*r.sh, tot = vml+vsh;
          totML += ml; totSH += sh; totValML += vml; totValSH += vsh; totVal += tot;
          doc.text(String(ml), xx+widths[1]/2, y+10, {align:'center'}); xx += widths[1];
          doc.text(String(sh), xx+widths[2]/2, y+10, {align:'center'}); xx += widths[2];
          doc.text('R$ '+fmt2(vml), xx+widths[3]/2, y+10, {align:'center'}); xx += widths[3];
          doc.text('R$ '+fmt2(vsh), xx+widths[4]/2, y+10, {align:'center'}); xx += widths[4];
          doc.text('R$ '+fmt2(tot), xx+widths[5]/2, y+10, {align:'center'});
        }
        y += 15;
      });

      checkPage(34);
      var sumCols = ['Qnt','ML','SH','TOTAL PCT','GERAL A RECEBER'];
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
      doc.text('R$ '+fmt2(totValML), sx+sumWidths[1]/2, y+11, {align:'center'}); sx += sumWidths[1];
      doc.text('R$ '+fmt2(totValSH), sx+sumWidths[2]/2, y+11, {align:'center'}); sx += sumWidths[2];
      doc.text('R$ '+fmt2(totVal), sx+sumWidths[3]/2, y+11, {align:'center'}); sx += sumWidths[3];
      doc.setTextColor(190,32,22); doc.setFont('helvetica','bold'); doc.setFontSize(9.5);
      doc.text('R$ '+fmt2(totVal), sx+sumWidths[4]/2, y+11.5, {align:'center'});
      y += 30;
    }

    quinzenaSection(1, '1ª QUINZENA');
    quinzenaSection(2, '2ª QUINZENA');

    doc.save('GMFLEX_'+driverName.replace(/\s+/g,'_')+'_'+MONTH_NAMES[state.month-1]+'_'+state.year+'.pdf');
  }

  boot();
  setTimeout(function(){
    var sp = document.getElementById('splash');
    if(sp){ sp.classList.add('hide'); setTimeout(function(){ sp.remove(); }, 600); }
  }, 1100);
})();
