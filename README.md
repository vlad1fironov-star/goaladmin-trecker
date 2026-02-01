# GoalAdmin & Tracker — Web MVP

## Вариант 3: вход + синхронизация (Supabase, email/password)

1) В Supabase создай проект.
2) Выполни SQL из файла `supabase_schema.sql` (Supabase -> SQL Editor).
3) Скопируй значения из Supabase -> Project Settings -> API:
   - Project URL
   - anon public key
4) Создай файл `.env` в корне проекта (или добавь переменные в Vercel):
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

После этого при запуске появится экран входа/регистрации.
Данные будут храниться в Supabase и синхронизироваться между устройствами.
