# RST — учёт и сверка железнодорожных маршрутов

Веб-приложение для регистрации маршрутов, внесения списков терминала и сверки номеров вагонов (контрольная цифра, лишние/отсутствующие, масса).

Стек: **Node.js + Express + better-sqlite3 + React + Vite + TypeScript**. Это сознательный выбор под деплой frontend на Vercel: Python/FastAPI + SQLite на serverless Vercel не персистится.

## Что где живёт

| Часть | Где запускать |
| --- | --- |
| Frontend (статический Vite build) | Vercel, любой static host |
| API + SQLite | Хост **с постоянным диском**: Railway, Fly.io, VPS, локальный Windows |

SQLite на Vercel serverless **нельзя** использовать как рабочую базу: файловая система эфемерна. Postgres/Firebase/Supabase по ТЗ запрещены.

## Требования

- Node.js 20+ (для `better-sqlite3` на Windows нужны инструменты сборки native-модулей: Visual Studio Build Tools с workload «Desktop development with C++»)
- Не кладите файл БД в OneDrive / Google Drive / Dropbox, пока приложение запущено

## Запуск на Windows

```bat
cd e:\Programming\Sites\RST
copy .env.example .env
npm install
npm run dev
```

Откройте http://localhost:3000

Переменные в `.env` (без секретов в git):

- `DATABASE_PATH` — путь к `rst.sqlite`
- `APP_ENV` — `development` или `production`
- `MAX_UPLOAD_MB`
- `OCR_PROVIDER` / `OCR_MODEL` / `OCR_API_KEY` — ключ Gemini только на сервере; без ключа фото можно не распознавать, ввод вручную остаётся
- `IMPORT_TEMP_DIR`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`
- `WEIGHT_MISMATCH_THRESHOLD_KG` — порог массы или `off`
- `CORS_ORIGIN` — origin frontend, например `https://your-app.vercel.app`

Справочники «Чугун», «Уголь», Świnoujście, Gdańsk создаются при первом запуске пустой БД.

Демо-маршруты **не** пишутся в production. Чтобы добавить учебные данные:

```bat
npm run seed:demo
```

(скрипт ничего не делает, если в БД уже есть маршруты)

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | API + Vite SPA на порту 3000 |
| `npm test` | unit + интеграционные тесты |
| `npm run lint` | `tsc --noEmit` (strict) |
| `npm run build` | статика frontend в `dist/` (для Vercel) |
| `npm run build:server` | бандл API в `dist/server.js` |
| `npm start` | production: API + раздача `dist/` |
| `npm run backup` | backup SQLite через backup API |
| `npm run seed:demo` | учебные маршруты (только в пустую таблицу routes) |

Резервная копия также доступна локально: `POST /api/backup`.

## Деплой

### Frontend на Vercel

1. `npm run build` → каталог `dist/`
2. Root / output: `dist`
3. `vercel.json` уже содержит SPA rewrite на `index.html`
4. Если API на другом хосте, соберите с `VITE_API_BASE_URL=https://api.example.com`

Vercel **не** поднимает Express и **не** хранит SQLite.

### API на хосте с диском

```bat
set APP_ENV=production
set DATABASE_PATH=D:\data\rst.sqlite
set CORS_ORIGIN=https://your-app.vercel.app
npm run build
npm run build:server
npm start
```

## Тесты

```bat
npm test
```

Покрыто: нормализация номера, контрольная цифра, разбор ручного ввода, расчёт статуса маршрута, создание маршрута, частичный список, extra-вагон, архив, rollback при невалидных номерах.

E2E в браузере в этот набор не входит.

## Docker (опционально)

```bat
docker compose up --build
```

Том `rst-data` хранит SQLite. Docker не обязателен для MVP.

## OCR

Провайдер изолирован (`server/ocr.ts`). Нужен `OCR_API_KEY` (или `GEMINI_API_KEY`). Результат OCR не пишется в маршрут до подтверждения таблицы. Если ключа нет — пользователь продолжает ручным вводом.
