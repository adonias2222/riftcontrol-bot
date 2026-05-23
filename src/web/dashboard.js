function renderDashboard(botName) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${botName} | Painel</title>
  <style>
    :root{--bg:#060914;--panel:rgba(15,23,42,.88);--card:rgba(17,24,39,.9);--line:rgba(148,163,184,.2);--text:#e5e7eb;--muted:#94a3b8;--ok:#22c55e;--warn:#f59e0b;--bad:#fb7185;--blue:#38bdf8;--violet:#a78bfa}*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Arial,Helvetica,sans-serif;color:var(--text);background:radial-gradient(circle at 15% 0%,rgba(56,189,248,.16),transparent 28%),radial-gradient(circle at 85% 10%,rgba(34,197,94,.13),transparent 26%),var(--bg);padding:22px}.shell{max-width:1180px;margin:auto}.hero,.grid{display:grid;gap:16px}.hero{grid-template-columns:1fr}.grid{grid-template-columns:1fr}@media(min-width:850px){.hero{grid-template-columns:1.25fr .95fr}.grid.cols4{grid-template-columns:repeat(4,1fr)}.grid.cols2{grid-template-columns:repeat(2,1fr)}}.panel,.card{border:1px solid var(--line);background:var(--panel);border-radius:24px;box-shadow:0 24px 80px rgba(0,0,0,.32)}.panel{padding:24px}.card{padding:18px}h1{font-size:clamp(30px,5vw,52px);margin:8px 0;letter-spacing:-1px}h2{margin:0 0 12px;font-size:18px}p{color:var(--muted);line-height:1.55}.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;padding:8px 12px;background:rgba(2,6,23,.48);font-weight:700}.dot{width:10px;height:10px;border-radius:999px;background:var(--warn);box-shadow:0 0 20px currentColor}.dot.ok{background:var(--ok);color:var(--ok)}.dot.bad{background:var(--bad);color:var(--bad)}.metric{border:1px solid var(--line);background:var(--card);border-radius:18px;padding:16px}.label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.value{font-size:24px;font-weight:900;margin-top:8px;word-break:break-word}.small{color:var(--muted);font-size:13px;margin-top:6px;word-break:break-word}input,button{width:100%;padding:13px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(2,6,23,.65);color:var(--text);font-size:15px;margin-top:8px}button{cursor:pointer;background:linear-gradient(135deg,var(--blue),var(--ok));color:#020617;font-weight:900;border:0}.secondary{background:rgba(148,163,184,.12);color:var(--text);border:1px solid var(--line)}.violet{background:linear-gradient(135deg,var(--violet),var(--blue));}.qrbox,.pairbox{min-height:180px;display:grid;place-items:center;border:1px dashed rgba(148,163,184,.28);border-radius:22px;background:rgba(2,6,23,.36);text-align:center;padding:18px}.qrbox{min-height:300px}.qrbox img{width:300px;max-width:100%;background:white;padding:12px;border-radius:18px}.paircode{font-size:34px;letter-spacing:6px;font-weight:900;color:#bbf7d0;background:#050816;border-radius:16px;padding:18px;margin:8px 0}.section{margin-top:16px}.kv{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:760px){.kv{grid-template-columns:210px 1fr}}.k{color:var(--muted)}.v{word-break:break-word}.badge{display:inline-flex;margin:3px 4px 3px 0;padding:7px 10px;border-radius:999px;background:rgba(148,163,184,.12);border:1px solid var(--line);font-size:13px}.badge.ok{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.35)}.badge.bad{background:rgba(251,113,133,.12);border-color:rgba(251,113,133,.35)}pre{white-space:pre-wrap;word-break:break-word;background:rgba(2,6,23,.58);border:1px solid var(--line);padding:14px;border-radius:16px;color:#fecaca;max-height:280px;overflow:auto}a{color:#7dd3fc;text-decoration:none}.links{display:flex;gap:10px;flex-wrap:wrap}.hint{font-size:13px;color:var(--muted)}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="panel">
        <div class="pill"><span id="statusDot" class="dot"></span><span id="statusText">carregando...</span></div>
        <h1>⚔️ ${botName}</h1>
        <p>Painel profissional de conexão do bot com atualização automática, diagnóstico, ambiente, erros, QR Code, pareamento por número e testes rápidos.</p>
        <div class="grid cols4 section">
          <div class="metric"><div class="label">Conexão</div><div id="mConexao" class="value">--</div><div id="mSocket" class="small">--</div></div>
          <div class="metric"><div class="label">QR Code</div><div id="mQr" class="value">--</div><div id="mQrAt" class="small">--</div></div>
          <div class="metric"><div class="label">Pareamento</div><div id="mPairing" class="value">--</div><div id="mPairingAt" class="small">--</div></div>
          <div class="metric"><div class="label">Comandos</div><div id="mCommands" class="value">--</div><div id="mMessages" class="small">--</div></div>
        </div>
        <div class="grid cols2 section">
          <div class="metric"><div class="label">Uptime</div><div id="mUptime" class="value">--</div><div id="mStarted" class="small">--</div></div>
          <div class="metric"><div class="label">Última mensagem</div><div id="mLastMsg" class="value">--</div><div id="mLastMsgAt" class="small">--</div></div>
        </div>
      </div>
      <div class="panel">
        <h2>🔐 QR Code</h2>
        <p>Digite a senha <strong>QR_PASSWORD</strong> para carregar o QR sem sair do painel.</p>
        <input id="panelKey" type="password" placeholder="Senha QR_PASSWORD" />
        <button onclick="saveKey()">Salvar senha e carregar QR</button>
        <button class="secondary" onclick="loadQr(true)">Atualizar QR agora</button>
        <div id="qrBox" class="qrbox section">Aguardando senha ou QR disponível...</div>
      </div>
    </section>

    <section class="grid cols2 section">
      <div class="card">
        <h2>📲 Pareamento por número</h2>
        <p>Use quando não quiser escanear QR. Digite o número do bot com DDI e DDD, por exemplo <strong>5598999999999</strong>.</p>
        <input id="pairPhone" type="tel" inputmode="numeric" placeholder="Número com DDI e DDD" />
        <button class="violet" onclick="generatePairing()">Gerar código de pareamento</button>
        <button class="secondary" onclick="openPairingPage()">Abrir página de pareamento</button>
        <div id="pairBox" class="pairbox section">Nenhum código gerado ainda.</div>
        <p class="hint">Digite o código imediatamente no WhatsApp do número do bot. Ele expira rápido.</p>
      </div>

      <div class="card"><h2>📡 Diagnóstico</h2><div class="kv"><div class="k">Status</div><div id="dStatus" class="v">--</div><div class="k">Auth</div><div id="dAuth" class="v">--</div><div class="k">Última abertura</div><div id="dOpenAt" class="v">--</div><div class="k">Último fechamento</div><div id="dCloseAt" class="v">--</div><div class="k">Código desconexão</div><div id="dDisconnect" class="v">--</div><div class="k">Última mensagem</div><div id="dLastMessage" class="v">--</div></div></div>
      <div class="card"><h2>🧩 Ambiente</h2><div id="envBadges">--</div><div class="section"><h2>⚙️ Processo</h2><div class="kv"><div class="k">Node</div><div id="pNode" class="v">--</div><div class="k">PID</div><div id="pPid" class="v">--</div><div class="k">Host</div><div id="pHost" class="v">--</div><div class="k">Memória</div><div id="pMemory" class="v">--</div></div></div></div>
      <div class="card"><h2>🧪 Testes</h2><p>Teste no WhatsApp:</p><span class="badge">!Naldo</span><span class="badge">!menu</span><span class="badge">!meuid</span><span class="badge">!idgrupo</span><span class="badge">!ranking</span><p>Se aparecer @lid, use !meuid e coloque o valor em OWNER_ID no Back4App.</p><div class="links"><a href="/status" target="_blank">JSON /status</a><a href="/health" target="_blank">/health</a><a href="/qr" target="_blank">QR antigo</a><a href="/pairing" target="_blank">Pareamento</a></div></div>
      <div class="card"><h2>🚨 Último erro</h2><pre id="lastError">Sem erro carregado.</pre></div>
    </section>
  </main>
<script>
const $=(id)=>document.getElementById(id);function fmt(v){if(!v)return'--';try{return new Date(v).toLocaleString('pt-BR')}catch{return v}}function dot(d){const el=$('statusDot');el.className='dot';if(d.conectado)el.classList.add('ok');else if(d.qrDisponivel||String(d.status).includes('aguardando')){}else el.classList.add('bad')}function badge(k,v){return '<span class="badge '+(v?'ok':'bad')+'">'+k+': '+(v?'OK':'NÃO')+'</span>'}async function loadStatus(){try{const r=await fetch('/status',{cache:'no-store'});const d=await r.json();dot(d);$('statusText').textContent=d.status||'--';$('mConexao').textContent=d.conectado?'Online':'Offline';$('mSocket').textContent=d.socketDisponivel?'socket ativo':'sem socket';$('mQr').textContent=d.qrDisponivel?'Disponível':'Indisponível';$('mQrAt').textContent=fmt(d.lastQrAt);$('mPairing').textContent=d.pairingDisponivel?'Gerado':(d.pairingCount?d.pairingCount:'--');$('mPairingAt').textContent=d.lastPairingAt?fmt(d.lastPairingAt):'sem código recente';$('mUptime').textContent=d.uptime||'--';$('mStarted').textContent='desde '+fmt(d.startedAt);$('mCommands').textContent=d.totalCommands??0;$('mMessages').textContent=(d.totalMessages??0)+' mensagens';$('mLastMsg').textContent=d.lastMessageInfo&&d.lastMessageInfo.textPreview?d.lastMessageInfo.textPreview:'--';$('mLastMsgAt').textContent=fmt(d.lastMessageAt);$('dStatus').textContent=d.status||'--';$('dAuth').textContent=d.auth||'--';$('dOpenAt').textContent=fmt(d.lastOpenAt);$('dCloseAt').textContent=fmt(d.lastCloseAt);$('dDisconnect').textContent=d.lastDisconnectCode??'--';$('dLastMessage').textContent=d.lastMessageInfo?JSON.stringify(d.lastMessageInfo):'--';$('envBadges').innerHTML=Object.keys(d.env||{}).map(k=>badge(k,Boolean(d.env[k]))).join('');const p=d.process||{};$('pNode').textContent=p.node||'--';$('pPid').textContent=p.pid||'--';$('pHost').textContent=p.host||'--';$('pMemory').textContent=p.memoryMB?p.memoryMB+' MB':'--';$('lastError').textContent=d.lastError||'Nenhum erro registrado.';if(d.qrDisponivel)loadQr(false)}catch(e){$('statusText').textContent='erro ao carregar';$('lastError').textContent=e.message||String(e)}}function saveKey(){localStorage.setItem('rift_panel_key',$('panelKey').value||'');loadQr(true)}async function loadQr(show){const key=$('panelKey').value||localStorage.getItem('rift_panel_key')||'';if(key&&!$('panelKey').value)$('panelKey').value=key;if(!key)return;try{const r=await fetch('/api/qr?key='+encodeURIComponent(key),{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Erro ao carregar QR');if(!d.qrDisponivel){$('qrBox').innerHTML='<div><strong>QR indisponível</strong><p>Status: '+(d.status||'--')+'</p></div>';return}$('qrBox').innerHTML='<img src="'+d.qrImage+'" alt="QR Code" /><p>Escaneie no WhatsApp do número do bot.</p>'}catch(e){if(show)$('qrBox').textContent=e.message||String(e)}}async function generatePairing(){const key=$('panelKey').value||localStorage.getItem('rift_panel_key')||'';const phone=$('pairPhone').value||'';if(!key){$('pairBox').textContent='Digite e salve a senha QR_PASSWORD primeiro.';return}if(!phone){$('pairBox').textContent='Digite o número com DDI e DDD.';return}localStorage.setItem('rift_panel_key',key);$('pairBox').textContent='Gerando código...';try{const r=await fetch('/api/pairing?key='+encodeURIComponent(key)+'&phone='+encodeURIComponent(phone),{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Erro ao gerar código');$('pairBox').innerHTML='<div><div>Código para '+d.phone+'</div><div class="paircode">'+d.code+'</div><div>Gerado em '+fmt(d.generatedAt)+'</div></div>';loadStatus()}catch(e){$('pairBox').textContent=e.message||String(e)}}function openPairingPage(){const key=$('panelKey').value||localStorage.getItem('rift_panel_key')||'';const phone=$('pairPhone').value||'';let url='/pairing';const params=[];if(key)params.push('key='+encodeURIComponent(key));if(phone)params.push('phone='+encodeURIComponent(phone));if(params.length)url+='?'+params.join('&');window.open(url,'_blank')}$('panelKey').value=localStorage.getItem('rift_panel_key')||'';loadStatus();loadQr(false);setInterval(loadStatus,3000);
</script>
</body>
</html>`;
}

module.exports = { renderDashboard };
