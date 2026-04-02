// Test banner — set TESTING_MODE=false to hide
(function(){
  if (!true) return; // TESTING_MODE: change to !false to hide
  // 닫아도 새로고침하면 다시 표시

  var T={ko:'테스트 중 · 실제 서비스 아님',en:'Testing · Not a live service',ja:'テスト中 · 実サービスではありません',zh:'测试中 · 非正式服务',vi:'Thử nghiệm · Không phải dịch vụ thật',es:'Prueba · No es servicio real',pt:'Teste · Não é serviço real',fr:'Test · Pas un service réel',de:'Test · Kein echter Dienst',ru:'Тест · Не реальный сервис',tr:'Test · Gerçek hizmet değil',ar:'اختبار · ليست خدمة حقيقية',hi:'परीक्षण · वास्तविक सेवा नहीं',th:'ทดสอบ · ไม่ใช่บริการจริง',id:'Uji coba · Bukan layanan nyata',mn:'Туршилт · Бодит биш',bn:'পরীক্ষা · প্রকৃত সেবা নয়',ur:'ٹیسٹ · حقیقی نہیں',ne:'परीक्षण · वास्तविक होइन',fa:'آزمایش · واقعی نیست',tl:'Pagsubok · Hindi tunay',my:'စမ်းသပ် · တကယ် မဟုတ်'};
  var msg = T[(navigator.language||'').slice(0,2)] || T.en;

  document.title = '[TEST] ' + document.title;

  var b = document.createElement('div');
  b.id = 'tb';
  b.innerHTML = msg + ' <span style="margin-left:6px;font-size:12px;opacity:.6">✕</span>';
  b.onclick = function(){ b.remove(); };
  document.body.appendChild(b);

  var s = document.createElement('style');
  s.textContent = '#tb{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:999999;background:rgba(255,193,7,.9);color:#000;padding:1px 12px;font-size:10px;font-family:sans-serif;border-radius:0 0 6px 6px;cursor:pointer;white-space:nowrap;pointer-events:auto;backdrop-filter:blur(4px)}';
  document.head.appendChild(s);
})();
