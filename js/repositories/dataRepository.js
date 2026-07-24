(function(){
  window.GMFLEX = window.GMFLEX || {};

  var QUEUE_KEY = 'gmflex-supabase-offline-queue-v1';
  var FAILED_QUEUE_KEY = 'gmflex-supabase-offline-failed-v1';
  var DEFAULT_TIMEOUT = 15000;

  function getClient(){
    return window.supabaseClient;
  }

  function uid(){
    if(window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function isNetworkError(error){
    if(!error) return false;
    var text = String(error.message || error.name || error.code || '').toLowerCase();
    return !navigator.onLine || text.indexOf('failed to fetch') !== -1 || text.indexOf('network') !== -1 || text.indexOf('timeout') !== -1;
  }

  function friendlyError(error){
    if(!error) return null;
    var text = String(error.message || error.details || error.code || '').toLowerCase();
    if(isNetworkError(error)) return 'Sem internet agora. A alteracao foi guardada para sincronizar depois.';
    if(text.indexOf('jwt') !== -1 || text.indexOf('token') !== -1) return 'Sua sessao expirou. Entre novamente.';
    if(text.indexOf('row-level security') !== -1 || text.indexOf('permission') !== -1 || text.indexOf('42501') !== -1) return 'Voce nao tem permissao para esta acao.';
    if(text.indexOf('duplicate') !== -1 || text.indexOf('unique') !== -1 || text.indexOf('23505') !== -1) return 'Este registro ja existe.';
    if(text.indexOf('timeout') !== -1) return 'O servidor demorou para responder. Tente novamente.';
    return 'Nao foi possivel sincronizar agora. Tente novamente em instantes.';
  }

  function withTimeout(promise, ms){
    var timer;
    var timeout = new Promise(function(_, reject){
      timer = setTimeout(function(){
        var error = new Error('timeout');
        error.code = 'TIMEOUT';
        reject(error);
      }, ms || DEFAULT_TIMEOUT);
    });
    return Promise.race([promise, timeout]).finally(function(){ clearTimeout(timer); });
  }

  async function safeQuery(operation){
    try{
      var result = await withTimeout(operation());
      if(result && result.error){
        result.error.userMessage = friendlyError(result.error);
      }
      return result;
    }catch(error){
      error.userMessage = friendlyError(error);
      error.isNetworkError = isNetworkError(error);
      return { data:null, error:error };
    }
  }

  function readQueue(){
    try{
      var raw = localStorage.getItem(QUEUE_KEY);
      var queue = raw ? JSON.parse(raw) : [];
      return Array.isArray(queue) ? queue : [];
    }catch(error){
      return [];
    }
  }

  function writeQueue(queue){
    try{ localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); }catch(error){}
  }

  // Itens que falharam por motivo PERMANENTE (não é problema de rede) durante o
  // processamento da fila offline - ex: RLS, dado que passou da validação local mas
  // foi rejeitado pelo banco. Ficam guardados separadamente para não travar o resto
  // da fila e para o usuário poder revisar o que não foi sincronizado.
  function readFailedQueue(){
    try{
      var raw = localStorage.getItem(FAILED_QUEUE_KEY);
      var queue = raw ? JSON.parse(raw) : [];
      return Array.isArray(queue) ? queue : [];
    }catch(error){
      return [];
    }
  }

  function writeFailedQueue(queue){
    try{ localStorage.setItem(FAILED_QUEUE_KEY, JSON.stringify(queue)); }catch(error){}
  }

  function enqueue(type, companyId, key, payload){
    var queue = readQueue();
    var item = { id:uid(), type:type, company_id:companyId, key:key, payload:payload, created_at:new Date().toISOString() };
    if(type === 'audit'){
      queue.push(item);
    }else{
      var replaced = false;
      queue = queue.map(function(existing){
        if(existing.company_id === companyId && existing.type === type && existing.key === key){
          replaced = true;
          return item;
        }
        return existing;
      });
      if(!replaced) queue.push(item);
    }
    writeQueue(queue);
    return item;
  }

  function sanitizeText(value, limit){
    value = String(value == null ? '' : value).replace(/[<>]/g, '').trim();
    return value.slice(0, limit || 200);
  }

  function normalizeEntry(entry){
    return {
      company_id: entry.company_id,
      date_key: entry.date_key,
      driver_name: sanitizeText(entry.driver_name, 120).toUpperCase(),
      ml_count: Math.max(0, parseInt(entry.ml_count, 10) || 0),
      sh_count: Math.max(0, parseInt(entry.sh_count, 10) || 0),
      updated_at: new Date().toISOString()
    };
  }

  function normalizeRate(rate){
    return {
      company_id: rate.company_id,
      driver_name: sanitizeText(rate.driver_name, 120).toUpperCase(),
      ml_rate: Math.max(0, Number(rate.ml_rate) || 0),
      sh_rate: Math.max(0, Number(rate.sh_rate) || 0),
      active: rate.active === false ? false : true,
      updated_at: new Date().toISOString()
    };
  }

  function normalizeSettings(settings){
    return {
      company_id: settings.company_id,
      empresa_nome: sanitizeText(settings.empresa_nome, 160),
      responsavel: sanitizeText(settings.responsavel, 160),
      telefone: sanitizeText(settings.telefone, 60),
      email: sanitizeText(settings.email, 160),
      tema: settings.tema === 'escuro' ? 'escuro' : 'claro',
      updated_at: new Date().toISOString()
    };
  }

  function monthBounds(year, month){
    var first = year + '-' + String(month).padStart(2, '0') + '-01';
    var lastDay = new Date(year, month, 0).getDate();
    var last = year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
    return { first:first, last:last };
  }

  // Enquanto a migração que adiciona a coluna "active" em driver_rates não for aplicada no banco,
  // um upsert com esse campo falharia por completo (coluna inexistente) e nada seria salvo -
  // nem a taxa, nem a remoção. Detectamos esse erro específico e tentamos de novo sem o campo
  // "active", para nao quebrar o restante do app; o chamador é avisado via `migrationNeeded`.
  function isMissingActiveColumnError(error){
    return isMissingColumnError(error, 'active');
  }

  // Detecta erro de "coluna inexistente" (migração SQL ainda não aplicada) para
  // uma coluna específica, sem depender de mensagens de erro exatas do Postgres/
  // PostgREST — cobre tanto o erro do driver Postgres (42703) quanto o cache de
  // schema do PostgREST (PGRST204), quando o nome da coluna aparece na mensagem.
  function isMissingColumnError(error, columnName){
    if(!error) return false;
    var text = String(error.message || error.details || error.hint || '').toLowerCase();
    var mentionsColumn = columnName ? text.indexOf(String(columnName).toLowerCase()) !== -1 : true;
    return (error.code === '42703' || error.code === 'PGRST204') &&
      (!columnName || mentionsColumn || text.indexOf('column') !== -1 || text.indexOf('schema cache') !== -1);
  }

  async function mutateOrQueue(type, companyId, key, payload, operation, options){
    options = options || {};
    if(!navigator.onLine && !options.forceOnline){
      return { data:null, error:null, queued:true, queueItem:enqueue(type, companyId, key, payload) };
    }
    var result = await safeQuery(operation);
    if(result.error && isNetworkError(result.error) && !options.skipQueue){
      return { data:null, error:result.error, queued:true, queueItem:enqueue(type, companyId, key, payload) };
    }
    return result;
  }

  var dataRepository = {
    queueKey: QUEUE_KEY,

    pendingCount: function(){
      return readQueue().length;
    },

    // Itens que falharam permanentemente (não voltam a ser tentados sozinhos).
    pendingFailedCount: function(){
      return readFailedQueue().length;
    },

    getFailedQueue: function(){
      return readFailedQueue();
    },

    // Remove um item da fila de falhas (ex: depois que o usuário resolveu manualmente
    // ou decidiu descartar aquele lançamento).
    clearFailedItem: function(id){
      var queue = readFailedQueue().filter(function(item){ return item.id !== id; });
      writeFailedQueue(queue);
      return queue.length;
    },

    clearAllFailed: function(){
      writeFailedQueue([]);
    },

    async getEntries(companyId, year, month){
      var bounds = monthBounds(year, month);
      return safeQuery(function(){
        return getClient()
          .from('entries')
          .select('*')
          .eq('company_id', companyId)
          .gte('date_key', bounds.first)
          .lte('date_key', bounds.last)
          .order('date_key', { ascending:true })
          .order('driver_name', { ascending:true });
      });
    },

    // Versão genérica de getEntries: aceita qualquer intervalo de datas (não só um mês
    // fechado). Necessária para calcular a Receita Total das Transportadoras no MESMO
    // período usado pelos filtros do Dashboard/Relatórios de Motoboys (hoje, semana,
    // ano, período customizado ou por motoboy) - ver correção do bug de Lucro Líquido.
    async getEntriesRange(companyId, dateFrom, dateTo){
      return safeQuery(function(){
        return getClient()
          .from('entries')
          .select('*')
          .eq('company_id', companyId)
          .gte('date_key', dateFrom)
          .lte('date_key', dateTo)
          .order('date_key', { ascending:true })
          .order('driver_name', { ascending:true });
      });
    },

    async upsertEntry(entry, options){
      entry = normalizeEntry(entry);
      return mutateOrQueue('entry', entry.company_id, entry.date_key + ':' + entry.driver_name, entry, function(){
        return getClient()
          .from('entries')
          .upsert(entry, { onConflict:'company_id,date_key,driver_name' })
          .select()
          .single();
      }, options);
    },

    async getRates(companyId){
      return safeQuery(function(){
        return getClient()
          .from('driver_rates')
          .select('*')
          .eq('company_id', companyId)
          .order('driver_name', { ascending:true });
      });
    },

    async upsertRate(rate, options){
      rate = normalizeRate(rate);
      var result = await mutateOrQueue('rate', rate.company_id, rate.driver_name, rate, function(){
        return getClient()
          .from('driver_rates')
          .upsert(rate, { onConflict:'company_id,driver_name' })
          .select()
          .single();
      }, options);
      if(result.error && isMissingActiveColumnError(result.error)){
        var fallback = { company_id:rate.company_id, driver_name:rate.driver_name, ml_rate:rate.ml_rate, sh_rate:rate.sh_rate, updated_at:rate.updated_at };
        var retry = await mutateOrQueue('rate', rate.company_id, rate.driver_name, fallback, function(){
          return getClient()
            .from('driver_rates')
            .upsert(fallback, { onConflict:'company_id,driver_name' })
            .select()
            .single();
        }, options);
        retry.migrationNeeded = true;
        return retry;
      }
      return result;
    },

    async upsertRates(companyId, rates, options){
      var rows = Object.keys(rates || {}).map(function(driver){
        return normalizeRate({
          company_id: companyId,
          driver_name: driver,
          ml_rate: rates[driver].ml,
          sh_rate: rates[driver].sh,
          active: rates[driver].active
        });
      });
      if(!rows.length) return { data:[], error:null };
      if(!navigator.onLine){
        rows.forEach(function(row){ enqueue('rate', companyId, row.driver_name, row); });
        return { data:null, error:null, queued:true };
      }
      var result = await safeQuery(function(){
        return getClient()
          .from('driver_rates')
          .upsert(rows, { onConflict:'company_id,driver_name' })
          .select();
      });
      if(result.error && isMissingActiveColumnError(result.error)){
        var fallbackRows = rows.map(function(r){
          return { company_id:r.company_id, driver_name:r.driver_name, ml_rate:r.ml_rate, sh_rate:r.sh_rate, updated_at:r.updated_at };
        });
        var retry = await safeQuery(function(){
          return getClient()
            .from('driver_rates')
            .upsert(fallbackRows, { onConflict:'company_id,driver_name' })
            .select();
        });
        retry.migrationNeeded = true;
        return retry;
      }
      return result;
    },

    async deleteRate(companyId, driverName, options){
      driverName = sanitizeText(driverName, 120).toUpperCase();
      return mutateOrQueue('rate_delete', companyId, driverName, { company_id:companyId, driver_name:driverName }, function(){
        return getClient()
          .from('driver_rates')
          .delete()
          .eq('company_id', companyId)
          .eq('driver_name', driverName);
      }, options);
    },

    async hasEntriesForDriver(companyId, driverName){
      driverName = sanitizeText(driverName, 120).toUpperCase();
      var result = await safeQuery(function(){
        return getClient()
          .from('entries')
          .select('id', { count:'exact', head:true })
          .eq('company_id', companyId)
          .eq('driver_name', driverName);
      });
      return { hasEntries: (result.count || 0) > 0, error: result.error };
    },

    async getSettings(companyId){
      return safeQuery(function(){
        return getClient()
          .from('settings')
          .select('*')
          .eq('company_id', companyId)
          .maybeSingle();
      });
    },

    async updateSettings(settings, options){
      settings = normalizeSettings(settings);
      var result = await mutateOrQueue('settings', settings.company_id, 'settings', settings, function(){
        return getClient()
          .from('settings')
          .upsert(settings, { onConflict:'company_id' })
          .select()
          .single();
      }, options);
      return result;
    },

    async getCompany(companyId){
      return safeQuery(function(){
        return getClient()
          .from('companies')
          .select('*')
          .eq('id', companyId)
          .maybeSingle();
      });
    },

    async updateCompany(companyId, values, options){
      var payload = {
        id: companyId,
        nome: sanitizeText(values.nome, 160),
        updated_at: new Date().toISOString()
      };
      return mutateOrQueue('company', companyId, 'company', payload, function(){
        return getClient()
          .from('companies')
          .upsert(payload, { onConflict:'id' })
          .select()
          .single();
      }, options);
    },

    async ensureUserCompany(companyName){
      return safeQuery(function(){
        return getClient().rpc('ensure_current_user_company', { company_name: sanitizeText(companyName || 'FINANCEIRO GM FLEX', 160) });
      });
    },

    async createAuditLog(log, options){
      var payload = {
        company_id: log.company_id,
        user_id: log.user_id || null,
        action_key: sanitizeText(log.action_key, 120),
        description: sanitizeText(log.description, 500),
        client_id: log.client_id || uid(),
        created_at: log.created_at || new Date().toISOString()
      };
      return mutateOrQueue('audit', payload.company_id, payload.client_id, payload, function(){
        return getClient()
          .from('audit_logs')
          .upsert(payload, { onConflict:'company_id,client_id' })
          .select()
          .single();
      }, options);
    },

    async getAuditLogs(companyId, limit){
      return safeQuery(function(){
        return getClient()
          .from('audit_logs')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending:false })
          .limit(limit || 300);
      });
    },

    // CORREÇÃO: antes, qualquer erro (inclusive um erro permanente como violação de
    // RLS ou dado inválido) interrompia o processamento e recolocava TODO o restante
    // da fila para trás dele - ou seja, um único item problemático travava a
    // sincronização de todos os lançamentos/tarifas/etc feitos depois dele,
    // indefinidamente (a próxima tentativa sempre falhava no mesmo item primeiro).
    // Agora: erro de REDE continua parando e reagendando (faz sentido tentar de novo
    // mais tarde, na ordem). Erro PERMANENTE (RLS, validação, etc.) move o item para
    // uma fila de falhas separada (FAILED_QUEUE_KEY) e o processamento CONTINUA com
    // os itens seguintes, para não bloquear o resto da sincronização.
    async processOfflineQueue(companyId){
      if(!navigator.onLine) return { data:null, error:null, pending:readQueue().length };
      var queue = readQueue();
      var remaining = [];
      var failed = readFailedQueue();
      var processed = 0;

      for(var i=0; i<queue.length; i++){
        var item = queue[i];
        if(companyId && item.company_id !== companyId){
          remaining.push(item);
          continue;
        }

        var result;
        if(item.type === 'entry') result = await this.upsertEntry(item.payload, { forceOnline:true, skipQueue:true });
        else if(item.type === 'rate') result = await this.upsertRate(item.payload, { forceOnline:true, skipQueue:true });
        else if(item.type === 'rate_delete') result = await this.deleteRate(item.company_id, item.payload.driver_name, { forceOnline:true, skipQueue:true });
        else if(item.type === 'settings') result = await this.updateSettings(item.payload, { forceOnline:true, skipQueue:true });
        else if(item.type === 'company') result = await this.updateCompany(item.company_id, item.payload, { forceOnline:true, skipQueue:true });
        else if(item.type === 'audit') result = await this.createAuditLog(item.payload, { forceOnline:true, skipQueue:true });

        if(result && result.error){
          if(isNetworkError(result.error)){
            // Sem internet no meio do processo: para aqui e devolve o restante (nesta
            // ordem) para a fila, para tentar novamente mais tarde.
            remaining = remaining.concat(queue.slice(i));
            writeQueue(remaining);
            return { data:{ processed:processed }, error:result.error, pending:remaining.length, failed:failed.length };
          }
          // Erro permanente: registra na fila de falhas (para o usuário poder revisar)
          // e segue para o próximo item, sem travar o restante da fila.
          failed.push({ id:item.id, type:item.type, company_id:item.company_id, key:item.key, payload:item.payload, error_message:(result.error.userMessage || result.error.message || 'Erro desconhecido'), failed_at:new Date().toISOString() });
          continue;
        }
        processed++;
      }

      writeFailedQueue(failed);
      writeQueue(remaining);
      if(failed.length){
        return { data:{ processed:processed }, error:null, pending:remaining.length, failed:failed.length, hasPermanentFailures:true };
      }
      return { data:{ processed:processed }, error:null, pending:remaining.length };
    },

    subscribeToChanges(companyId, table, callback){
      var filter = table === 'companies' ? 'id=eq.' + companyId : 'company_id=eq.' + companyId;
      return getClient()
        .channel('gmflex-' + table + '-' + companyId)
        .on('postgres_changes', { event:'*', schema:'public', table:table, filter:filter }, callback)
        .subscribe();
    },

    subscribeToCompanyChanges(companyId, callback){
      return getClient()
        .channel('gmflex-company-' + companyId)
        .on('postgres_changes', { event:'*', schema:'public', table:'entries', filter:'company_id=eq.' + companyId }, function(payload){ callback('entries', payload); })
        .on('postgres_changes', { event:'*', schema:'public', table:'driver_rates', filter:'company_id=eq.' + companyId }, function(payload){ callback('driver_rates', payload); })
        .on('postgres_changes', { event:'*', schema:'public', table:'settings', filter:'company_id=eq.' + companyId }, function(payload){ callback('settings', payload); })
        .on('postgres_changes', { event:'*', schema:'public', table:'audit_logs', filter:'company_id=eq.' + companyId }, function(payload){ callback('audit_logs', payload); })
        .on('postgres_changes', { event:'*', schema:'public', table:'profiles', filter:'company_id=eq.' + companyId }, function(payload){ callback('profiles', payload); })
        .on('postgres_changes', { event:'*', schema:'public', table:'companies', filter:'id=eq.' + companyId }, function(payload){ callback('companies', payload); })
        .subscribe();
    },

    friendlyError: friendlyError
  };

  window.GMFLEX.dataRepository = dataRepository;
})();
