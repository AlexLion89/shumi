-- Замеры связи с телефона (этап 0): дошёл ли запрос и за сколько.
CREATE TABLE netlog (
  at   INTEGER NOT NULL,  -- время замера на телефоне, мс с 1970-01-01 UTC
  k    TEXT    NOT NULL,  -- ping-cf | ping-gh | search-litres | search-fantlab | search-openlibrary
  ok   INTEGER NOT NULL,  -- 1 — ответ пришёл, 0 — ошибка или не дождались
  ms   INTEGER NOT NULL,  -- время до ответа или до отказа
  err  TEXT,              -- при отказе: timeout | net | http502 …
  dev  TEXT    NOT NULL,  -- случайный id устройства из localStorage
  colo TEXT,              -- дата-центр Cloudflare, принявший пачку замеров
  UNIQUE (dev, at, k)
);
CREATE INDEX netlog_at ON netlog (at);
