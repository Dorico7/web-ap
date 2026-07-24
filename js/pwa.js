(function(){
  var deferredInstallPrompt = null;

  function isStandalone(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  window.addEventListener('beforeinstallprompt', function(event){
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  window.addEventListener('appinstalled', function(){
    deferredInstallPrompt = null;
  });

  if('serviceWorker' in navigator && window.location.protocol !== 'file:'){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('./service-worker.js').catch(function(error){
        console.warn('Service worker indisponível:', error);
      });
    });
  }

  window.GMFLEXPWA = {
    isStandalone: isStandalone,
    install: function(){
      if(isStandalone()){
        return Promise.resolve({ok:false, message:'O aplicativo já está instalado'});
      }
      if(!deferredInstallPrompt){
        return Promise.resolve({ok:false, message:'Use o menu do navegador para instalar'});
      }

      return deferredInstallPrompt.prompt()
        .then(function(){ return deferredInstallPrompt.userChoice; })
        .then(function(choice){
          var accepted = choice && choice.outcome === 'accepted';
          deferredInstallPrompt = null;
          return {ok:accepted, message: accepted ? 'Instalação iniciada' : 'Instalação cancelada'};
        })
        .catch(function(){
          deferredInstallPrompt = null;
          return {ok:false, message:'Não foi possível instalar agora'};
        });
    }
  };
})();
