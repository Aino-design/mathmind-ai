# ИИ Тетрадь — руководство по Cloudflare Pages

Данный репозиторий содержит решение для мгновенных ответов ИИ, отображения процесса размышления (`ИИ думает...`) и подмешивания контекста "ИИ Тетради".

---

## 🚀 Решенные проблемы

1. **Ответы на вопросы**:
   - Если в Cloudflare добавлен `GROQ_API_KEY`, запрос сначала отправляется в Groq Qwen с потоковой выдачей.
   - При отказе Groq запрос переходит к текущей схеме Gemini (или DeepSeek, если его вручную включили).
2. **Процесс размышления (Thinking Stream)**:
   - DeepSeek-R1 можно включить отдельно (`USE_DEEPSEEK=true`) при наличии баланса. Если DeepSeek откажет, Worker попробует Gemini.
3. **Интеграция с ИИ Тетрадью**:
   - Содержимое обеих страниц тетради подмешивается в контекст запроса пользователя (`notebookContent`).
4. **Защита от ошибки `Unexpected end of JSON input`**:
   - В `cloudflare_worker_ai.js` и `pwa_ai_client.js` добавлена строгая проверка заголовков `Content-Type: application/json` и безопасно обработаны SSE-стримы.
5. **Адаптивность для ноутбуков & UX чата**:
   - Адаптирована верстка правого блока тетради (`min-width: 0`), добавлено редактирование названий тетрадей и фокус на поле ввода при открытии чата.

---

## Отдельный Cloudflare Worker (если не используете Pages Function)

1. Создайте Cloudflare Worker и вставьте код из **`cloudflare_worker_ai.js`**.
2. В консоли Cloudflare задайте секреты с ключами API:
   ```bash
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put GROQ_API_KEY
   npx wrangler secret put DEEPSEEK_API_KEY
   ```
   * **`GEMINI_API_KEY`**: ключ из [Google AI Studio](https://aistudio.google.com/); используется как резерв, если Groq не настроен или недоступен.
   * **`GROQ_API_KEY`**: необязательный ключ из [Groq Console](https://console.groq.com/keys). Если он добавлен, вопросы и контекст тетради отправляются в Groq Qwen.
   * **`DEEPSEEK_API_KEY`**: ключ из [DeepSeek Platform](https://platform.deepseek.com/), необязателен.
   * **`USE_DEEPSEEK=true`**: необязательная переменная для включения DeepSeek. Если её не задавать, запросы идут только через Gemini.

3. Если используете отдельный Worker, настройте его адрес в PWA или добавьте маршрут, который направляет /api/chat в этот Worker.

---

## 📱 Развертывание PWA Фронтенда

Разместите файлы **`index.html`** и **`pwa_ai_client.js`** на вашем веб-сервере.

При открытии приложения кликните на названия тетрадей ("Левая страница", "Правая страница") для переименования.

## Cloudflare Pages: подключение /api/chat

В репозитории есть Pages Function по пути functions/api/chat.js. Cloudflare Pages сопоставляет этот файл с адресом /api/chat; одного файла cloudflare_worker_ai.js в корне для этого недостаточно.

1. Подключите этот GitHub-репозиторий в Workers & Pages → Create application → Pages → Connect to Git.
2. Для проекта без сборки оставьте команду сборки пустой, а каталог публикации укажите точкой: .
3. Откройте Pages-проект mathmind-ai → Settings → Variables and Secrets и добавьте зашифрованный production secret с точным именем GEMINI_API_KEY.
4. Запустите новый deployment и дождитесь статуса Success.
5. Проверьте https://ВАШ-САЙТ.pages.dev/api/chat в браузере: GET должен показать JSON о работе Worker. Затем проверьте чат в приложении.

Для Pages добавьте production secrets `GROQ_API_KEY` и `GEMINI_API_KEY` через настройки проекта или `npx wrangler pages secret put ИМЯ --project-name mathmind-ai`, затем создайте новый deployment. Groq Qwen используется первым, Gemini Flash 3.8/3.7/3.6 — резервом. Лимиты провайдеров не складываются в гарантированную общую квоту: резерв помогает при отказе основного сервиса, но у него тоже есть собственные ограничения. DeepSeek выключен по умолчанию, чтобы запросы не зависели от его платного баланса. Ключи хранятся только в Cloudflare Secrets и не должны попадать в GitHub.
