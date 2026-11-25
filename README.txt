LOW POLY SEHIR - COK OYUNCULU

Yerelde calistirma:
  npm install
  npm start
  tarayicida http://localhost:3000 (baska sekmeler/cihazlar da ayni adrese girerek katilir)

Internete acma (ornek: Render.com, ucretsiz katman):
  1) Bu klasoru bir GitHub deposuna yukle.
  2) Render > New > Web Service > depoyu sec.
  3) Build Command: npm install   |   Start Command: npm start
  4) Yayin bitince Render'in verdigi https adresi herkesin girebilecegi oyun linkidir.
  (Railway, Fly.io veya WebSocket destekleyen herhangi bir Node.js hosting de olur.)

Dosyalar:
  server.js          sunucu: oyuncular, WebSocket, trafik simulasyonu
  public/index.html  oyun (istemci), sunucu tarafindan servis edilir
