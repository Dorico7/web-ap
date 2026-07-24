(function(){
  window.GMFLEX = window.GMFLEX || {};

  function getClient(){
    return window.supabaseClient;
  }

  function normalizeEmail(email){
    return String(email || '').trim().toLowerCase();
  }

  function friendlyAuthError(error){
    if(!error) return null;
    var message = String(error.message || '').toLowerCase();
    if(message.indexOf('invalid login credentials') !== -1) return 'E-mail ou senha incorretos.';
    if(message.indexOf('email not confirmed') !== -1) return 'Confirme seu e-mail antes de entrar.';
    if(message.indexOf('password') !== -1 && message.indexOf('characters') !== -1) return 'A senha precisa ter pelo menos 6 caracteres.';
    if(message.indexOf('user already registered') !== -1 || message.indexOf('already registered') !== -1) return 'Este e-mail ja esta cadastrado.';
    if(message.indexOf('rate limit') !== -1) return 'Muitas tentativas. Aguarde alguns instantes e tente novamente.';
    if(message.indexOf('jwt') !== -1 || message.indexOf('token') !== -1) return 'Sua sessao expirou. Entre novamente.';
    if(!navigator.onLine) return 'Sem internet. Verifique a conexao e tente novamente.';
    return 'Nao foi possivel concluir a autenticacao. Tente novamente.';
  }

  async function safeCall(operation){
    try{
      var result = await operation();
      if(result && result.error){
        result.error.userMessage = friendlyAuthError(result.error);
      }
      return result;
    }catch(error){
      error.userMessage = friendlyAuthError(error);
      return { data:null, error:error };
    }
  }

  var authService = {
    async signUp(payload){
      payload = payload || {};
      return safeCall(function(){
        return getClient().auth.signUp({
          email: normalizeEmail(payload.email),
          password: String(payload.password || ''),
          options: {
            data: {
              nome: String(payload.nome || '').trim(),
              company_name: String(payload.companyName || '').trim(),
              invite_token: String(payload.inviteToken || '').trim()
            }
          }
        });
      });
    },

    async signIn(email, password){
      return safeCall(function(){
        return getClient().auth.signInWithPassword({
          email: normalizeEmail(email),
          password: String(password || '')
        });
      });
    },

    async signOut(){
      return safeCall(function(){
        return getClient().auth.signOut();
      });
    },

    async resetPassword(email){
      var redirectTo = window.location.href.split('#')[0].split('?')[0];
      return safeCall(function(){
        return getClient().auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo: redirectTo });
      });
    },

    async updatePassword(password){
      return safeCall(function(){
        return getClient().auth.updateUser({ password: String(password || '') });
      });
    },

    async getSession(){
      return safeCall(function(){
        return getClient().auth.getSession();
      });
    },

    async refreshSession(){
      return safeCall(function(){
        return getClient().auth.refreshSession();
      });
    },

    async getCurrentUser(){
      var result = await safeCall(function(){
        return getClient().auth.getUser();
      });
      return result.error ? null : result.data.user;
    },

    async getProfile(userId){
      return safeCall(function(){
        return getClient()
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
      });
    },

    onAuthStateChange(callback){
      return getClient().auth.onAuthStateChange(callback);
    },

    canManageCompany(profile){
      return !!profile && (profile.cargo === 'Administrador' || profile.cargo === 'Gerente');
    },

    canManageRates(profile){
      return !!profile && (profile.cargo === 'Administrador' || profile.cargo === 'Gerente');
    },

    canWriteEntries(profile){
      return !!profile && ['Administrador','Gerente','Funcionario','Funcionário'].indexOf(profile.cargo) !== -1;
    },

    friendlyAuthError: friendlyAuthError
  };

  window.GMFLEX.authService = authService;
})();
