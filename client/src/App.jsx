import { useEffect, useState } from 'react';
import { api } from './services/api.js';

export default function App() {
  const [status, setStatus] = useState('Bağlantı kontrol ediliyor…');

  useEffect(() => {
    const controller = new AbortController();
    api.get('/health', { signal: controller.signal })
      .then(() => setStatus('Geliştirme ortamı hazır.'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('Servise ulaşılamıyor. Lütfen tekrar deneyin.');
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">ARAÇ KİRALAMA YÖNETİM SİSTEMİ</p>
      <h1>SmartRent</h1>
      <p>Proje geliştirme aşamasında.</p>
      <p role="status">{status}</p>
    </main>
  );
}
