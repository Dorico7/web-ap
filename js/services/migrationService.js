(function(){
  window.GMFLEX = window.GMFLEX || {};

  var STORAGE_KEY = 'gmflex-financeiro-v3';
  var CUSTOM_RATES_KEY = 'gmflex-financeiro-v3-parceiras-extra';
  var SETTINGS_KEY = 'gmflex-settings-v1';
  var AUDIT_KEY = 'gmflex-audit-v1';

  function markerKey(companyId){
    return 'gmflex-supabase-migrated-' + companyId;
  }

  function safeParse(raw, fallback){
    try{ return raw ? JSON.parse(raw) : fallback; }catch(error){ return fallback; }
  }

  function settingsPayload(companyId, settings){
    settings = settings || {};
    return {
      company_id: companyId,
      empresa_nome: settings.empresa || 'FINANCEIRO GM FLEX',
      responsavel: settings.responsavel || 'GUILHERME MARQUES',
      telefone: settings.telefone || '',
      email: settings.email || '',
      tema: settings.tema === 'escuro' ? 'escuro' : 'claro'
    };
  }

  var migrationService = {
    async ensureBaselineData(companyId, defaultRates, defaultSettings){
      var repo = window.GMFLEX.dataRepository;
      var ratesResult = await repo.getRates(companyId);
      if(!ratesResult.error && (!ratesResult.data || ratesResult.data.length === 0)){
        await repo.upsertRates(companyId, defaultRates || {}, { forceOnline:true, skipQueue:true });
      }

      var settingsResult = await repo.getSettings(companyId);
      if(!settingsResult.error && !settingsResult.data){
        await repo.updateSettings(settingsPayload(companyId, defaultSettings), { forceOnline:true, skipQueue:true });
      }
    },

    async migrateLocalStorage(companyId, defaultRates, defaultSettings, userId){
      var repo = window.GMFLEX.dataRepository;
      if(!companyId || !navigator.onLine) return { ok:false, skipped:true };

      await this.ensureBaselineData(companyId, defaultRates, defaultSettings);

      if(localStorage.getItem(markerKey(companyId)) === 'ok'){
        return { ok:true, skipped:true };
      }

      var rawEntries = localStorage.getItem(STORAGE_KEY);
      var entries = safeParse(rawEntries, {});
      for(var dateKey in entries){
        if(!Object.prototype.hasOwnProperty.call(entries, dateKey)) continue;
        for(var driverName in entries[dateKey]){
          if(!Object.prototype.hasOwnProperty.call(entries[dateKey], driverName)) continue;
          var entry = entries[dateKey][driverName] || {};
          await repo.upsertEntry({
            company_id: companyId,
            date_key: dateKey,
            driver_name: driverName,
            ml_count: entry.ml || 0,
            sh_count: entry.sh || 0
          }, { forceOnline:true, skipQueue:true });
        }
      }

      var extraRates = safeParse(localStorage.getItem(CUSTOM_RATES_KEY), {});
      for(var rateName in extraRates){
        if(!Object.prototype.hasOwnProperty.call(extraRates, rateName)) continue;
        await repo.upsertRate({
          company_id: companyId,
          driver_name: rateName,
          ml_rate: extraRates[rateName].ml || 0,
          sh_rate: extraRates[rateName].sh || 0
        }, { forceOnline:true, skipQueue:true });
      }

      var settings = safeParse(localStorage.getItem(SETTINGS_KEY), null);
      if(settings){
        await repo.updateSettings(settingsPayload(companyId, settings), { forceOnline:true, skipQueue:true });
        await repo.updateCompany(companyId, { nome: settings.empresa || 'FINANCEIRO GM FLEX' }, { forceOnline:true, skipQueue:true });
      }

      var audit = safeParse(localStorage.getItem(AUDIT_KEY), []);
      if(Array.isArray(audit)){
        for(var i=0; i<audit.length; i++){
          await repo.createAuditLog({
            company_id: companyId,
            user_id: userId || null,
            action_key: 'legacy:' + i,
            description: audit[i].a || 'Registro migrado',
            created_at: audit[i].created_at || new Date().toISOString()
          }, { forceOnline:true, skipQueue:true });
        }
      }

      localStorage.setItem(markerKey(companyId), 'ok');
      return { ok:true, skipped:false };
    }
  };

  window.GMFLEX.migrationService = migrationService;
})();
