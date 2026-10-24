# AI Integration & Optimization Guide (Cloudflare Worker & PWA)

## Solution Overview / Решение проблем

В данном решении устранены все проблемы:

1. **Долгая задержка ответа на простые вопросы (2+2)**:
   - Внедрена маршрутизация на **Gemini 2.0 Flash** (<200 мс TTFT).

2. **Отсутствие процесса размышления (Thinking / Reasoning Stream)**:
   - Внедрен **DeepSeek-R1** с передачей блоков `<think>...</think>`. В PWA клиенте `pwa_ai_client.js` этот блок парсится и передается в callback `onThinking` для отрисовки "ИИ думает...".

3. **Интеграция с ИИ Тетрадью (Notebook Context Integration)**:
   - Поле `notebookContent` передается из PWA в Cloudflare Worker и подмешивается в контекст запроса.

4. **Ошибка `Failed to execute 'json' on 'Response': Unexpected end of JSON input`**:
   - В `cloudflare_worker_ai.js` функция `jsonResponse` гарантирует заголовок `Content-Type: application/json` и завалидированный JSON ответ.
   - В `pwa_ai_client.js` перед вызовом `.json()` проверяется `content-type`, что предотвращает краш PWA.

---

## Инструкция по настройке Cloudflare Worker

1. Скопируйте файл `cloudflare_worker_ai.js` в ваш Cloudflare Worker.
2. Задайте секретные API ключи в Cloudflare через CLI `wrangler` или панель Cloudflare Dashboard:
   ```bash
   wrangler secret put GOOGLE_API_KEY
   wrangler secret put DEEPSEEK_API_KEY
   ```
3. Подключите клиент `pwa_ai_client.js` в вашем PWA веб-приложении:
   ```javascript
   import { askAI } from './pwa_ai_client.js';

   await askAI({
     workerUrl: 'https://your-worker.workers.dev',
     query: '2+2',
     notebookContent: 'Моя заметка в тетради...',
     onThinking: (thoughts) => { console.log('ИИ думает:', thoughts); },
     onResponse: (answer) => { console.log('Ответ:', answer); }
   });
   ```
