(() => {
  "use strict";
  function closePanel(){document.getElementById("walletPanel")?.remove();}
  function panel(title,html){
    closePanel();
    const overlay=document.createElement("div");overlay.id="walletPanel";overlay.className="wallet-panel-backdrop";
    overlay.innerHTML=`<section class="wallet-panel" role="dialog" aria-modal="true" aria-labelledby="walletPanelTitle"><h2 id="walletPanelTitle">${title}</h2>${html}</section>`;
    document.body.appendChild(overlay);return overlay;
  }
  let joining=false;
  window.startQuickPlay=profile=>{
    if(joining)return;
    if(!socket.connected||!session.walletToken)return toast("Attends la connexion au serveur puis réessaie.");
    joining=true;
    socket.timeout(15000).emit("quick:join",{name:profile.name,avatar:profile.icon,walletToken:session.walletToken},(err,res)=>{
      joining=false;
      if(err||!res?.ok){socket.emit("quick:cancel",{});if(!res?.cancelled)toast(res?.error||"La recherche n’a pas répondu. Réessaie.");}
    });
  };
  socket.on("quick:matched",res=>{
    closePanel();setWalletState(res.walletToken,res.balance);saveSession(res.code,res.playerId);session.state=res.state;render();
  });
  socket.on("disconnect",()=>{
    joining=false;
    if(session.state?.mode==="quick"&&session.state?.phase==="lobby"){closePanel();clearSession();renderHome();toast("Recherche annulée après la perte de connexion.");}
  });
  socket.on("room:closed",res=>{
    if(res?.reason!=="match_cancelled")return;
    closePanel();clearSession();renderHome();toast(res.message||"Lancement annulé.");
  });
  window.openWalletHistory=()=>{
    const el=panel("Mon portefeuille",`<p>Solde : <strong>${getCoins()} pièces</strong></p><div id="walletHistory" role="status">Chargement…</div><button id="walletClose" type="button">Fermer</button>`);
    el.querySelector("#walletClose").onclick=closePanel;
    socket.timeout(8000).emit("wallet:history",{token:session.walletToken,limit:30},(err,res)=>{
      const list=el.querySelector("#walletHistory");if(!list?.isConnected)return;
      if(err||!res?.ok){list.textContent="Historique indisponible. Réessaie dans un instant.";return;}
      list.innerHTML=res.transactions.length?res.transactions.map(tx=>`<div class="wallet-history-row"><span>${escapeHtml(tx.note||tx.type)}<small>${escapeHtml(new Date(tx.at).toLocaleString("fr-FR"))}</small></span><strong>${tx.delta>0?"+":""}${Number(tx.delta)||0}</strong></div>`).join(""):"Aucun mouvement récent.";
    });
  };
})();
