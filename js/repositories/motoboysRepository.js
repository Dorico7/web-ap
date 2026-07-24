(function(){
  'use strict';

  window.GMFLEX = window.GMFLEX || {};

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
    if(isNetworkError(error)) return 'Sem internet agora. Tente novamente quando a conexão for restaurada.';
    if(text.indexOf('jwt') !== -1 || text.indexOf('token') !== -1) return 'Sua sessão expirou. Entre novamente.';
    if(text.indexOf('row-level security') !== -1 || text.indexOf('permission') !== -1 || text.indexOf('42501') !== -1) return 'Você não tem permissão para esta ação.';
    if(text.indexOf('duplicate') !== -1 || text.indexOf('unique') !== -1 || text.indexOf('23505') !== -1) return 'Este registro já existe.';
    if(text.indexOf('foreign key') !== -1 || text.indexOf('23503') !== -1) return 'Não é possível excluir: existem lançamentos vinculados.';
    return 'Não foi possível concluir a operação. Tente novamente.';
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

  function sanitizeText(value, limit){
    value = String(value == null ? '' : value).replace(/[<>]/g, '').trim();
    return value.slice(0, limit || 200);
  }

  function sanitizeMoney(value){
    var n = parseFloat(String(value).replace(',', '.'));
    return isNaN(n) || n < 0 ? 0 : Math.round(n * 100) / 100;
  }

  function sanitizeInt(value){
    var n = parseInt(value, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  // ─── Normalizers ──────────────────────────────────────────────────────────

  function normalizeMotoboy(data){
    return {
      company_id: data.company_id,
      nome: sanitizeText(data.nome, 160).toUpperCase(),
      telefone: sanitizeText(data.telefone || '', 30),
      cpf: sanitizeText(data.cpf || '', 20),
      pix: sanitizeText(data.pix || '', 160),
      status: data.status === 'Inativo' ? 'Inativo' : 'Ativo',
      updated_at: new Date().toISOString()
    };
  }

  function normalizeMotoboiRate(data){
    return {
      company_id: data.company_id,
      motoboy_id: data.motoboy_id,
      transportadora: sanitizeText(data.transportadora, 120).toUpperCase(),
      valor_pacote: sanitizeMoney(data.valor_pacote),
      updated_at: new Date().toISOString()
    };
  }

  function normalizeMotorista(data){
    return {
      company_id: data.company_id,
      nome: sanitizeText(data.nome, 160).toUpperCase(),
      telefone: sanitizeText(data.telefone || '', 30),
      valor_diaria: sanitizeMoney(data.valor_diaria != null ? data.valor_diaria : 70),
      status: data.status === 'Inativo' ? 'Inativo' : 'Ativo',
      updated_at: new Date().toISOString()
    };
  }

  function normalizeMotoboiEntry(data){
    return {
      company_id: data.company_id,
      date_key: data.date_key,
      transportadora: sanitizeText(data.transportadora, 120).toUpperCase(),
      motoboy_id: data.motoboy_id,
      motorista_id: data.motorista_id || null,
      quantidade_pacotes: sanitizeInt(data.quantidade_pacotes),
      valor_recebido: sanitizeMoney(data.valor_recebido),
      valor_motoboy: sanitizeMoney(data.valor_motoboy),
      observacoes: sanitizeText(data.observacoes || '', 500),
      updated_at: new Date().toISOString()
    };
  }

  var TIPOS_PESSOA = ['MOTOBOY', 'MOTORISTA'];

  function normalizeTipoPessoa(value){
    return TIPOS_PESSOA.indexOf(value) !== -1 ? value : 'MOTOBOY';
  }

  // Vale/adiantamento — genérico para MOTOBOY ou MOTORISTA (`tipo_pessoa` +
  // `pessoa_id`). valor > 0 é obrigatório (checado também no banco via CHECK
  // constraint); sanitizeMoney nunca retorna negativo, mas permite 0 — a
  // validação de "maior que zero" é reforçada na UI e no banco.
  //
  // Retrocompatível: além de `tipo_pessoa`/`pessoa_id`, também aceita o antigo
  // campo `motoboy_id` (qualquer código ainda não migrado para o modelo
  // genérico) — nesse caso assume tipo_pessoa MOTOBOY.
  function normalizeAdiantamento(data){
    var tipoPessoa = normalizeTipoPessoa(data.tipo_pessoa || (data.motoboy_id ? 'MOTOBOY' : null));
    var pessoaId = data.pessoa_id || data.motoboy_id;
    return {
      company_id: data.company_id,
      tipo_pessoa: tipoPessoa,
      pessoa_id: pessoaId,
      data_key: data.data_key,
      valor: sanitizeMoney(data.valor),
      motivo: sanitizeText(data.motivo || '', 120),
      observacao: sanitizeText(data.observacao || '', 500),
      status: data.status === 'Descontado' ? 'Descontado' : 'Pendente',
      fechamento_mes: (data.fechamento_mes != null && data.fechamento_mes !== '') ? (parseInt(data.fechamento_mes, 10) || null) : null,
      fechamento_ano: (data.fechamento_ano != null && data.fechamento_ano !== '') ? (parseInt(data.fechamento_ano, 10) || null) : null,
      fechamento_quinzena: (data.fechamento_quinzena === 1 || data.fechamento_quinzena === 2) ? data.fechamento_quinzena : null,
      descontado_em: data.descontado_em || null,
      usuario_id: data.usuario_id || null,
      usuario_nome: sanitizeText(data.usuario_nome || '', 160),
      updated_at: new Date().toISOString()
    };
  }

  // Projeta uma linha de `adiantamentos` de volta no formato antigo
  // (`motoboy_id`) quando tipo_pessoa === 'MOTOBOY', para qualquer chamador
  // ainda não migrado que espere esse campo. Não tem custo para quem já usa
  // `pessoa_id`/`tipo_pessoa` diretamente — os dois campos coexistem no objeto.
  function withLegacyMotoboyId(row){
    if(row && row.tipo_pessoa === 'MOTOBOY') row.motoboy_id = row.pessoa_id;
    return row;
  }
  function withLegacyMotoboyIdList(rows){
    (rows || []).forEach(withLegacyMotoboyId);
    return rows;
  }

  // ─── Company Modules ──────────────────────────────────────────────────────

  var motoboysRepository = {

    async getModules(companyId){
      return safeQuery(function(){
        return getClient()
          .from('company_modules')
          .select('*')
          .eq('company_id', companyId);
      });
    },

    async isModuleEnabled(companyId, moduleName){
      var result = await safeQuery(function(){
        return getClient()
          .from('company_modules')
          .select('enabled')
          .eq('company_id', companyId)
          .eq('module_name', moduleName)
          .maybeSingle();
      });
      if(result.error) return false;
      return !!(result.data && result.data.enabled);
    },

    async setModuleEnabled(companyId, moduleName, enabled){
      var payload = {
        company_id: companyId,
        module_name: sanitizeText(moduleName, 60),
        enabled: !!enabled,
        updated_at: new Date().toISOString()
      };
      return safeQuery(function(){
        return getClient()
          .from('company_modules')
          .upsert(payload, { onConflict:'company_id,module_name' })
          .select()
          .single();
      });
    },

    // ─── Motoboys ────────────────────────────────────────────────────────────

    async getMotoboys(companyId, includeInactive){
      return safeQuery(function(){
        var q = getClient()
          .from('motoboys')
          .select('*')
          .eq('company_id', companyId)
          .order('nome', { ascending:true });
        if(!includeInactive) q = q.eq('status', 'Ativo');
        return q;
      });
    },

    async upsertMotoboy(data){
      var payload = normalizeMotoboy(data);
      if(data.id){
        payload.id = data.id;
        return safeQuery(function(){
          return getClient()
            .from('motoboys')
            .upsert(payload, { onConflict:'id' })
            .select()
            .single();
        });
      }
      return safeQuery(function(){
        return getClient()
          .from('motoboys')
          .insert(payload)
          .select()
          .single();
      });
    },

    async deleteMotoboy(companyId, motoboyId){
      // Verificar se há lançamentos vinculados
      var check = await safeQuery(function(){
        return getClient()
          .from('motoboy_entries')
          .select('id', { count:'exact', head:true })
          .eq('company_id', companyId)
          .eq('motoboy_id', motoboyId);
      });
      if(check.count > 0){
        return { data:null, error:{ userMessage:'Não é possível excluir: existem lançamentos vinculados a este motoboy. Desative-o em vez de excluir.' } };
      }
      // Verificar se há adiantamentos (pendentes ou já descontados) vinculados
      var checkAdi = await safeQuery(function(){
        return getClient()
          .from('adiantamentos')
          .select('id', { count:'exact', head:true })
          .eq('company_id', companyId)
          .eq('tipo_pessoa', 'MOTOBOY')
          .eq('pessoa_id', motoboyId);
      });
      if(checkAdi.count > 0){
        return { data:null, error:{ userMessage:'Não é possível excluir: existem adiantamentos vinculados a este motoboy. Desative-o em vez de excluir.' } };
      }
      return safeQuery(function(){
        return getClient()
          .from('motoboys')
          .delete()
          .eq('company_id', companyId)
          .eq('id', motoboyId);
      });
    },

    // ─── Motoboy Rates ───────────────────────────────────────────────────────

    async getMotoboiRates(companyId, motoboyId){
      var q = getClient()
        .from('motoboy_rates')
        .select('*')
        .eq('company_id', companyId)
        .order('transportadora', { ascending:true });
      if(motoboyId) q = q.eq('motoboy_id', motoboyId);
      return safeQuery(function(){ return q; });
    },

    async upsertMotoboiRate(data){
      var payload = normalizeMotoboiRate(data);
      if(data.id) payload.id = data.id;
      return safeQuery(function(){
        return getClient()
          .from('motoboy_rates')
          .upsert(payload, { onConflict:'company_id,motoboy_id,transportadora' })
          .select()
          .single();
      });
    },

    async deleteMotoboiRate(companyId, rateId){
      return safeQuery(function(){
        return getClient()
          .from('motoboy_rates')
          .delete()
          .eq('company_id', companyId)
          .eq('id', rateId);
      });
    },

    // ─── Motoristas ──────────────────────────────────────────────────────────

    async getMotoristas(companyId, includeInactive){
      return safeQuery(function(){
        var q = getClient()
          .from('motoristas')
          .select('*')
          .eq('company_id', companyId)
          .order('nome', { ascending:true });
        if(!includeInactive) q = q.eq('status', 'Ativo');
        return q;
      });
    },

    async upsertMotorista(data){
      var payload = normalizeMotorista(data);
      if(data.id){
        payload.id = data.id;
        return safeQuery(function(){
          return getClient()
            .from('motoristas')
            .upsert(payload, { onConflict:'id' })
            .select()
            .single();
        });
      }
      return safeQuery(function(){
        return getClient()
          .from('motoristas')
          .insert(payload)
          .select()
          .single();
      });
    },

    async deleteMotorista(companyId, motoristaId){
      var check = await safeQuery(function(){
        return getClient()
          .from('motoboy_entries')
          .select('id', { count:'exact', head:true })
          .eq('company_id', companyId)
          .eq('motorista_id', motoristaId);
      });
      if(check.count > 0){
        return { data:null, error:{ userMessage:'Não é possível excluir: existem lançamentos vinculados a este motorista. Desative-o em vez de excluir.' } };
      }
      var checkAdi = await safeQuery(function(){
        return getClient()
          .from('adiantamentos')
          .select('id', { count:'exact', head:true })
          .eq('company_id', companyId)
          .eq('tipo_pessoa', 'MOTORISTA')
          .eq('pessoa_id', motoristaId);
      });
      if(checkAdi.count > 0){
        return { data:null, error:{ userMessage:'Não é possível excluir: existem adiantamentos vinculados a este motorista. Desative-o em vez de excluir.' } };
      }
      return safeQuery(function(){
        return getClient()
          .from('motoristas')
          .delete()
          .eq('company_id', companyId)
          .eq('id', motoristaId);
      });
    },

    // ─── Lançamentos (motoboy_entries) ───────────────────────────────────────

    async getEntries(companyId, filters){
      filters = filters || {};
      return safeQuery(function(){
        var q = getClient()
          .from('motoboy_entries')
          .select('*, motoboys(id,nome), motoristas(id,nome,valor_diaria)')
          .eq('company_id', companyId)
          .order('date_key', { ascending:false })
          .order('created_at', { ascending:false });
        if(filters.dateFrom) q = q.gte('date_key', filters.dateFrom);
        if(filters.dateTo)   q = q.lte('date_key', filters.dateTo);
        if(filters.motoboyId) q = q.eq('motoboy_id', filters.motoboyId);
        if(filters.motoristaId) q = q.eq('motorista_id', filters.motoristaId);
        if(filters.transportadora) q = q.eq('transportadora', filters.transportadora);
        if(filters.limit) q = q.limit(filters.limit);
        return q;
      });
    },

    async upsertEntry(data){
      var payload = normalizeMotoboiEntry(data);
      if(data.id){
        payload.id = data.id;
        return safeQuery(function(){
          return getClient()
            .from('motoboy_entries')
            .upsert(payload, { onConflict:'id' })
            .select()
            .single();
        });
      }
      return safeQuery(function(){
        return getClient()
          .from('motoboy_entries')
          .insert(payload)
          .select()
          .single();
      });
    },

    async deleteEntry(companyId, entryId){
      return safeQuery(function(){
        return getClient()
          .from('motoboy_entries')
          .delete()
          .eq('company_id', companyId)
          .eq('id', entryId);
      });
    },

    // ─── Adiantamentos (Vales) ───────────────────────────────────────────────
    // Modelo genérico: uma única tabela `adiantamentos`, com `tipo_pessoa`
    // ('MOTOBOY' | 'MOTORISTA') e `pessoa_id`. Não há embed de FK (pessoa_id
    // aponta para tabelas diferentes conforme o tipo), então o nome da pessoa é
    // resolvido no módulo, a partir das listas de motoboys/motoristas já
    // carregadas em memória — mantendo esta camada simples e sem duplicar a
    // consulta de perfis relacionados.
    //
    // Retrocompatibilidade: `filters.motoboyId` (usado por todo o código já
    // existente do módulo de Motoboys) continua funcionando exatamente como
    // antes — é equivalente a { tipoPessoa:'MOTOBOY', pessoaId: motoboyId }.

    async getAdiantamentos(companyId, filters){
      filters = filters || {};
      var tipoPessoa = filters.tipoPessoa || (filters.motoboyId ? 'MOTOBOY' : null);
      var pessoaId = filters.pessoaId || filters.motoboyId;
      var result = await safeQuery(function(){
        var q = getClient()
          .from('adiantamentos')
          .select('*')
          .eq('company_id', companyId)
          .order('data_key', { ascending:false })
          .order('created_at', { ascending:false });
        if(tipoPessoa) q = q.eq('tipo_pessoa', tipoPessoa);
        if(pessoaId) q = q.eq('pessoa_id', pessoaId);
        if(filters.status) q = q.eq('status', filters.status);
        if(filters.dateFrom) q = q.gte('data_key', filters.dateFrom);
        if(filters.dateTo) q = q.lte('data_key', filters.dateTo);
        return q;
      });
      if(!result.error) withLegacyMotoboyIdList(result.data);
      return result;
    },

    async upsertAdiantamento(data){
      var payload = normalizeAdiantamento(data);
      if(data.id){
        payload.id = data.id;
        var updateResult = await safeQuery(function(){
          return getClient()
            .from('adiantamentos')
            .upsert(payload, { onConflict:'id' })
            .select()
            .single();
        });
        if(!updateResult.error) withLegacyMotoboyId(updateResult.data);
        return updateResult;
      }
      var insertResult = await safeQuery(function(){
        return getClient()
          .from('adiantamentos')
          .insert(payload)
          .select()
          .single();
      });
      if(!insertResult.error) withLegacyMotoboyId(insertResult.data);
      return insertResult;
    },

    // Exclui um adiantamento (Pendente OU Descontado). A confirmação com o aviso
    // apropriado para cada caso fica a cargo da UI (ver _handleDeleteAdiantamento
    // no módulo) — aqui a exclusão em si não é restrita por status, só por
    // empresa. A segurança de quem pode excluir continua garantida pela RLS
    // (adiantamentos_write_manager: só Administrador/Gerente da própria
    // empresa).
    async deleteAdiantamento(companyId, id){
      return safeQuery(function(){
        return getClient()
          .from('adiantamentos')
          .delete()
          .eq('company_id', companyId)
          .eq('id', id);
      });
    },

    // Marca em lote os adiantamentos informados como "Descontado", vinculando-os
    // ao mês/ano/QUINZENA do fechamento que os consumiu (os pagamentos são feitos
    // por quinzena, então cada desconto pertence sempre a uma quinzena específica).
    // Só afeta adiantamentos que ainda estejam "Pendente" (dupla proteção contra
    // desconto duplicado, além da própria tela já recalcular os ids pendentes a
    // cada carregamento).
    async marcarAdiantamentosDescontados(companyId, ids, fechamentoMes, fechamentoAno, fechamentoQuinzena){
      if(!Array.isArray(ids) || ids.length === 0) return { data:[], error:null };
      var payload = {
        status: 'Descontado',
        fechamento_mes: fechamentoMes || null,
        fechamento_ano: fechamentoAno || null,
        fechamento_quinzena: (fechamentoQuinzena === 1 || fechamentoQuinzena === 2) ? fechamentoQuinzena : null,
        descontado_em: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      var result = await safeQuery(function(){
        return getClient()
          .from('adiantamentos')
          .update(payload)
          .eq('company_id', companyId)
          .eq('status', 'Pendente')
          .in('id', ids)
          .select();
      });
      if(!result.error) withLegacyMotoboyIdList(result.data);
      return result;
    },

    /**
     * Soma os adiantamentos por status.
     * @param {Array} adiantamentos
     * @returns {Object} { totalPendente, totalDescontado, totalGeral }
     */
    calcAdiantamentosTotais(adiantamentos){
      if(!Array.isArray(adiantamentos)) return { totalPendente:0, totalDescontado:0, totalGeral:0 };
      var totalPendente = 0, totalDescontado = 0;
      adiantamentos.forEach(function(a){
        var v = parseFloat(a.valor) || 0;
        if(a.status === 'Descontado') totalDescontado += v; else totalPendente += v;
      });
      totalPendente = Math.round(totalPendente * 100) / 100;
      totalDescontado = Math.round(totalDescontado * 100) / 100;
      return {
        totalPendente: totalPendente,
        totalDescontado: totalDescontado,
        totalGeral: Math.round((totalPendente + totalDescontado) * 100) / 100
      };
    },

    /**
     * Agrupa os adiantamentos PENDENTES por PESSOA (motoboy OU motorista,
     * conforme `tipoPessoa`) e por QUINZENA do fechamento, já que o pagamento é
     * feito quinzenalmente (não em uma única parcela mensal). Lógica única de
     * desconto, reaproveitada pelo fechamento de Motoboys e de Motoristas.
     *
     * Regra de corte: um adiantamento pertence à 1ª quinzena se sua data (data_key)
     * for até o dia 15 do mês do fechamento (q1CutoffDateKey); senão, pertence à
     * 2ª quinzena. Isso também "varre" automaticamente qualquer saldo antigo ainda
     * não descontado (de meses anteriores) para a 1ª quinzena do fechamento atual —
     * a primeira oportunidade de cobrança — em vez de deixá-lo perdido fora do
     * cálculo.
     *
     * @param {Array} adiantamentos - todos os adiantamentos da empresa (qualquer status/tipo)
     * @param {string} tipoPessoa - 'MOTOBOY' ou 'MOTORISTA'
     * @param {string} q1CutoffDateKey - último dia da 1ª quinzena do mês do fechamento, formato 'YYYY-MM-DD'
     * @returns {Object} { [pessoa_id]: { q1:{pendente,itensPendentes}, q2:{pendente,itensPendentes} } }
     */
    calcAdiantamentosPorPessoaQuinzena(adiantamentos, tipoPessoa, q1CutoffDateKey){
      if(!Array.isArray(adiantamentos)) return {};
      var byPessoa = {};
      adiantamentos.forEach(function(a){
        if(a.status === 'Descontado') return; // só interessa o que ainda falta cobrar
        if(tipoPessoa && a.tipo_pessoa !== tipoPessoa) return;
        var pessoaId = a.pessoa_id || a.motoboy_id;
        if(!byPessoa[pessoaId]){
          byPessoa[pessoaId] = {
            q1: { pendente:0, itensPendentes:[] },
            q2: { pendente:0, itensPendentes:[] }
          };
        }
        var v = parseFloat(a.valor) || 0;
        var bucket = (a.data_key && a.data_key <= q1CutoffDateKey) ? 'q1' : 'q2';
        byPessoa[pessoaId][bucket].pendente += v;
        byPessoa[pessoaId][bucket].itensPendentes.push(a.id);
      });
      Object.keys(byPessoa).forEach(function(id){
        byPessoa[id].q1.pendente = Math.round(byPessoa[id].q1.pendente * 100) / 100;
        byPessoa[id].q2.pendente = Math.round(byPessoa[id].q2.pendente * 100) / 100;
      });
      return byPessoa;
    },

    // Retrocompatível: assinatura e comportamento idênticos aos de antes da
    // generalização — todo o código já existente do Fechamento de Motoboys
    // continua funcionando sem qualquer alteração.
    calcAdiantamentosPorMotoboyQuinzena(adiantamentos, q1CutoffDateKey){
      return this.calcAdiantamentosPorPessoaQuinzena(adiantamentos, 'MOTOBOY', q1CutoffDateKey);
    },

    // ─── Helpers de Cálculo ──────────────────────────────────────────────────

    /**
     * Calcula o valor do motoboy para um lançamento.
     * Busca a tarifa na lista de rates já carregada em memória.
     * @param {Array} rates - lista de motoboy_rates carregada
     * @param {string} motoboyId
     * @param {string} transportadora
     * @param {number} qtdPacotes
     * @returns {number}
     */
    calcValorMotoboy(rates, motoboyId, transportadora, qtdPacotes){
      if(!Array.isArray(rates)) return 0;
      var rate = rates.find(function(r){
        return r.motoboy_id === motoboyId && r.transportadora === transportadora.toUpperCase();
      });
      if(!rate) return 0;
      return Math.round(rate.valor_pacote * qtdPacotes * 100) / 100;
    },

    /**
     * Calcula o lucro de um lançamento.
     * A diária do motorista NÃO é descontada por lançamento individual.
     * @param {number} valorRecebido
     * @param {number} valorMotoboy
     * @returns {number}
     */
    calcLucroEntrada(valorRecebido, valorMotoboy){
      return Math.round((valorRecebido - valorMotoboy) * 100) / 100;
    },

    /**
     * Calcula o total de diárias de motoristas para um conjunto de lançamentos.
     * A diária é contabilizada UMA ÚNICA VEZ por motorista por dia.
     * @param {Array} entries - lançamentos com motoristas(valor_diaria)
     * @returns {number}
     */
    calcTotalDiarias(entries){
      if(!Array.isArray(entries)) return 0;
      // Agrupa por date_key + motorista_id para contar apenas uma diária por dia
      var seen = {};
      var total = 0;
      entries.forEach(function(e){
        if(!e.motorista_id) return;
        var key = e.date_key + ':' + e.motorista_id;
        if(seen[key]) return;
        seen[key] = true;
        var diaria = e.motoristas ? parseFloat(e.motoristas.valor_diaria) || 0 : 0;
        total += diaria;
      });
      return Math.round(total * 100) / 100;
    },

    /**
     * Agrupa o total de diárias por motorista para um conjunto de lançamentos.
     * A diária é contabilizada UMA ÚNICA VEZ por motorista por dia (mesma regra
     * de calcTotalDiarias). Útil para telas/PDFs que precisam detalhar quanto
     * cada motorista tem a receber, e não só o total geral.
     * @param {Array} entries - lançamentos com motoristas(nome,valor_diaria)
     * @returns {Array} [{ motorista_id, nome, dias, valorDiaria, total }], ordenado por total desc
     */
    calcDiariasPorMotorista(entries){
      if(!Array.isArray(entries)) return [];
      var seenDays = {};
      var byMotorista = {};
      entries.forEach(function(e){
        if(!e.motorista_id) return;
        var dayKey = e.date_key + ':' + e.motorista_id;
        if(seenDays[dayKey]) return;
        seenDays[dayKey] = true;
        var nome = e.motoristas ? e.motoristas.nome : '—';
        var valorDiaria = e.motoristas ? (parseFloat(e.motoristas.valor_diaria) || 0) : 0;
        if(!byMotorista[e.motorista_id]){
          byMotorista[e.motorista_id] = { motorista_id: e.motorista_id, nome: nome, dias: 0, valorDiaria: valorDiaria, total: 0 };
        }
        byMotorista[e.motorista_id].dias += 1;
        byMotorista[e.motorista_id].total = Math.round((byMotorista[e.motorista_id].total + valorDiaria) * 100) / 100;
      });
      return Object.keys(byMotorista).map(function(id){ return byMotorista[id]; })
        .sort(function(a,b){ return b.total - a.total; });
    },

    /**
     * Agrupa Pago Motoboys e Diárias Motoristas POR DIA (date_key), para uso na
     * aba "Lançar → Entrada de Pacotes" (Lucro Líquido do dia = Entrada − Base
     * − Pago Motoboys − Diárias Motoristas). A diária de cada motorista só é
     * contada 1x por dia, mesma regra de calcTotalDiarias/calcDiariasPorMotorista.
     * @param {Array} entries - lançamentos (de qualquer período; a função agrupa sozinha)
     * @returns {Object} { [date_key]: { totalMotoboys, totalDiarias } }
     */
    aggregateByDay(entries){
      if(!Array.isArray(entries)) return {};
      var byDay = {};
      var seenDiaria = {}; // "date_key:motorista_id" -> true, evita contar a diária 2x no mesmo dia
      entries.forEach(function(e){
        var day = e.date_key;
        if(!day) return;
        if(!byDay[day]) byDay[day] = { totalMotoboys:0, totalDiarias:0 };
        byDay[day].totalMotoboys += parseFloat(e.valor_motoboy) || 0;
        if(e.motorista_id){
          var seenKey = day + ':' + e.motorista_id;
          if(!seenDiaria[seenKey]){
            seenDiaria[seenKey] = true;
            var diaria = e.motoristas ? (parseFloat(e.motoristas.valor_diaria) || 0) : 0;
            byDay[day].totalDiarias += diaria;
          }
        }
      });
      Object.keys(byDay).forEach(function(day){
        byDay[day].totalMotoboys = Math.round(byDay[day].totalMotoboys * 100) / 100;
        byDay[day].totalDiarias = Math.round(byDay[day].totalDiarias * 100) / 100;
      });
      return byDay;
    },

    /**
     * Agrega totais de um conjunto de lançamentos.
     * @param {Array} entries
     * @returns {Object}
     */
    aggregateTotals(entries){
      if(!Array.isArray(entries)) return { totalRecebido:0, totalMotoboys:0, totalDiarias:0, lucroLiquido:0, totalPacotes:0, totalEntregas:0 };
      var totalRecebido = 0, totalMotoboys = 0, totalPacotes = 0;
      entries.forEach(function(e){
        totalRecebido += parseFloat(e.valor_recebido) || 0;
        totalMotoboys += parseFloat(e.valor_motoboy) || 0;
        totalPacotes += parseInt(e.quantidade_pacotes, 10) || 0;
      });
      var totalDiarias = this.calcTotalDiarias(entries);
      totalRecebido = Math.round(totalRecebido * 100) / 100;
      totalMotoboys = Math.round(totalMotoboys * 100) / 100;
      var lucroLiquido = Math.round((totalRecebido - totalMotoboys - totalDiarias) * 100) / 100;
      return {
        totalRecebido: totalRecebido,
        totalMotoboys: totalMotoboys,
        totalDiarias: totalDiarias,
        lucroLiquido: lucroLiquido,
        totalPacotes: totalPacotes,
        totalEntregas: entries.length
      };
    }
  };

  window.GMFLEX.motoboysRepository = motoboysRepository;

})();
