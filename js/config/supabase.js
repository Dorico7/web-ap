(function(){
  window.GMFLEX = window.GMFLEX || {};

  function normalizeUrl(url){
    url = String(url || '').trim();
    if(!url) return '';
    if(!/^https?:\/\//i.test(url)) return 'https://' + url;
    return url.replace(/\/+$/, '');
  }

  var env = window.env || {};
  var config = {
    URL: normalizeUrl(env.SUPABASE_URL),
    ANON_KEY: String(env.SUPABASE_ANON_KEY || '').trim()
  };

  window.GMFLEX.SUPABASE_CONFIG = config;

  if(!config.URL || !config.ANON_KEY){
    console.warn('Configuracao do Supabase ausente. Preencha env.js com SUPABASE_URL e SUPABASE_ANON_KEY.');
  }
})();
