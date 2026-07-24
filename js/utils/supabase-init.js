(function(){
  window.GMFLEX = window.GMFLEX || {};

  function initSupabase(){
    var config = window.GMFLEX.SUPABASE_CONFIG || {};
    if(!window.supabase || !window.supabase.createClient){
      console.error('Biblioteca do Supabase nao carregada.');
      return null;
    }

    if(!config.URL || !config.ANON_KEY){
      console.error('Credenciais do Supabase ausentes.');
      return null;
    }

    if(window.supabaseClient) return window.supabaseClient;

    window.supabaseClient = window.supabase.createClient(config.URL, config.ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      },
      realtime: {
        params: { eventsPerSecond: 10 }
      }
    });

    return window.supabaseClient;
  }

  window.GMFLEX.initSupabase = initSupabase;
})();
