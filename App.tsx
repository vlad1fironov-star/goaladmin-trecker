import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import {
  Plus,
  Settings as SettingsIcon,
  LayoutDashboard,
  CalendarDays,
  BarChart3,
  Bell,
  GripVertical,
  Trash2,
  Pencil,
  Quote,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Flame,
  CheckCircle2,
  Circle,
} from "lucide-react";

import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Switch } from "./components/ui/switch";
import { Textarea } from "./components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
  RadialBarChart,
  RadialBar,
} from "recharts";

type ThemeMode = "dark" | "light";
type GoalCategory = "Все" | "Маркетинг" | "Продажи" | "Продукт" | "Работа" | "Здоровье" | "Спорт" | "Личное";

type Goal = {
  id: string;
  title: string;
  category: Exclude<GoalCategory, "Все">;
  reminderTime?: string;
  subtasks: { id: string; text: string; weight: "normal" | "hard" }[];
};

type DailyEntry = { dateISO: string; checks: Record<string, boolean>; notes: string };

type WidgetKind = "heatmap" | "chart" | "streak";
type Widget = { id: string; kind: WidgetKind; chartType?: "line" | "bar" };

type NotificationSettings = {
  enabled: boolean;
  quietHoursEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  morningBriefEnabled: boolean;
  morningTime: string;
  eveningReportEnabled: boolean;
  eveningTime: string;
  goalRemindersEnabled: boolean;
  perGoalEnabled: Record<string, boolean>;
};

type AppState = {
  theme: ThemeMode;
  goals: Goal[];
  entries: DailyEntry[];
  widgets: Widget[];
  notification: NotificationSettings;
  adminCategoryFilter: GoalCategory;
};

type Tab = "admin" | "daily" | "stats" | "settings";

const STORAGE_KEY = "goaladmin_tracker_web_v1";
const TOKENS = { primary: "#13ec13" };

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function hash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return h | 0;
}
function levelFromXP(xp: number) {
  let lvl = 1;
  let need = 200;
  let rest = xp;
  while (rest >= need) {
    rest -= need;
    lvl += 1;
    need += 100;
  }
  return { level: lvl, progress: rest, nextNeed: need };
}
function getAllTaskKeys(goals: Goal[]) {
  return goals.flatMap((g) => g.subtasks.map((t) => `${g.id}::${t.id}`));
}
function computeTotalXP(goals: Goal[], entries: DailyEntry[]) {
  const weight = new Map<string, "normal" | "hard">();
  for (const g of goals) for (const t of g.subtasks) weight.set(`${g.id}::${t.id}`, t.weight);
  let xp = 0;
  for (const e of entries) {
    for (const [k, v] of Object.entries(e.checks)) {
      if (!v) continue;
      const w = weight.get(k) ?? "normal";
      xp += w === "hard" ? 20 : 10;
    }
  }
  return xp;
}
function computeStreak(entries: DailyEntry[]) {
  const map = new Map(entries.map((e) => [e.dateISO, e]));
  let streak = 0;
  let d = new Date();
  while (true) {
    const iso = todayISO(d);
    const e = map.get(iso);
    const any = e ? Object.values(e.checks).some(Boolean) : false;
    if (!any) break;
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    return JSON.parse(raw) as AppState;
  } catch {
    const seedGoals: Goal[] = [
      {
        id: uid("g"),
        title: "Запуск бренда Q3",
        category: "Маркетинг",
        reminderTime: "10:00",
        subtasks: [
          { id: uid("t"), text: "Согласование дизайна", weight: "hard" },
          { id: uid("t"), text: "Настройка рекламы", weight: "normal" },
        ],
      },
      {
        id: uid("g"),
        title: "10 новых клиентов",
        category: "Продажи",
        reminderTime: "15:00",
        subtasks: [{ id: uid("t"), text: "1 звонок", weight: "hard" }],
      },
    ];

    const notification: NotificationSettings = {
      enabled: true,
      quietHoursEnabled: true,
      quietFrom: "22:00",
      quietTo: "07:00",
      morningBriefEnabled: true,
      morningTime: "08:00",
      eveningReportEnabled: true,
      eveningTime: "21:00",
      goalRemindersEnabled: true,
      perGoalEnabled: Object.fromEntries(seedGoals.map((g) => [g.id, true])),
    };

    return {
      theme: "dark",
      goals: seedGoals,
      entries: [],
      widgets: [
        { id: uid("w"), kind: "heatmap" },
        { id: uid("w"), kind: "chart", chartType: "line" },
        { id: uid("w"), kind: "streak" },
      ],
      notification,
      adminCategoryFilter: "Все",
    };
  }
}
function saveState(s: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function MainApp() {
  const [tab, setTab] = useState<Tab>("admin");
  const [state, setState] = useState<AppState>(() => loadState());

  useEffect(() => saveState(state), [state]);
  useEffect(() => { document.documentElement.style.setProperty("--primary", TOKENS.primary); }, []);

  useEffect(() => {
    setState((s) => {
      const map = { ...s.notification.perGoalEnabled };
      let changed = false;
      for (const g of s.goals) {
        if (map[g.id] === undefined) { map[g.id] = true; changed = true; }
      }
      for (const k of Object.keys(map)) {
        if (!s.goals.some((g) => g.id === k)) { delete map[k]; changed = true; }
      }
      return changed ? { ...s, notification: { ...s.notification, perGoalEnabled: map } } : s;
    });
  }, [state.goals.length]);

  return (
    <div className="min-h-[100dvh] w-full flex justify-center bg-[var(--bgdarker,#0b1b0b)] text-white">
      <div className="w-full max-w-[430px] min-h-[100dvh] bg-[var(--bgdark,#102210)] shadow-2xl overflow-hidden relative">
        <Header tab={tab} onTab={setTab} />
        <main className="pb-24">
          {tab === "admin" && (
            <AdminDashboard
              goals={state.goals}
              filter={state.adminCategoryFilter}
              onFilter={(f) => setState((s) => ({ ...s, adminCategoryFilter: f }))}
              notif={state.notification}
              onGoals={(goals) => setState((s) => ({ ...s, goals }))}
              onNotif={(notification) => setState((s) => ({ ...s, notification }))}
            />
          )}
          {tab === "daily" && (
            <DailyPlanner
              goals={state.goals}
              entries={state.entries}
              onEntries={(entries) => setState((s) => ({ ...s, entries }))}
            />
          )}
          {tab === "stats" && (
            <Stats
              goals={state.goals}
              entries={state.entries}
              widgets={state.widgets}
              onWidgets={(widgets) => setState((s) => ({ ...s, widgets }))}
            />
          )}
          {tab === "settings" && (
            <Settings
              theme={state.theme}
              onTheme={(theme) => setState((s) => ({ ...s, theme }))}
              notif={state.notification}
              goals={state.goals}
              onNotif={(notification) => setState((s) => ({ ...s, notification }))}
              onReset={() => { localStorage.removeItem(STORAGE_KEY); setState(loadState()); setTab("admin"); }}
            />
          )}
        </main>
        <BottomNav tab={tab} onTab={setTab} />
      </div>
    </div>
  );
}

function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const title =
    tab === "admin" ? "Панель управления" :
    tab === "daily" ? "Ежедневник" :
    tab === "stats" ? "Статистика" : "Настройки";

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[var(--bgdark,#102210)]/90 backdrop-blur">
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="size-10 rounded-full border-2 border-[color:var(--primary)]/30 bg-black/20 grid place-items-center">
          <LayoutDashboard className="size-5" />
        </div>
        <div className="flex-1">
          <div className="text-lg font-extrabold tracking-tight leading-tight">{title}</div>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full bg-white/5 hover:bg-white/10" onClick={() => onTab("settings")} aria-label="Настройки">
          <Bell className="size-5" />
        </Button>
      </div>
    </header>
  );
}

function BottomNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const item = (key: Tab, label: string, Icon: any) => {
    const active = tab === key;
    return (
      <button
        className={"flex flex-col items-center justify-center gap-1 flex-1 py-3 " + (active ? "text-[color:var(--primary)]" : "text-white/50")}
        onClick={() => onTab(key)}
      >
        <Icon className="size-5" />
        <span className="text-[11px] font-extrabold">{label}</span>
      </button>
    );
  };
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-center">
      <div className="w-full max-w-[430px] border-t border-white/10 bg-[var(--bgdark,#102210)]/95 backdrop-blur">
        <div className="flex">
          {item("admin", "Цели", LayoutDashboard)}
          {item("daily", "Планировщик", CalendarDays)}
          {item("stats", "Статистика", BarChart3)}
          {item("settings", "Профиль", SettingsIcon)}
        </div>
      </div>
    </nav>
  );
}

// Admin screen

function AdminDashboard({
  goals, filter, onFilter, onGoals, notif, onNotif,
}: {
  goals: Goal[];
  filter: GoalCategory;
  onFilter: (f: GoalCategory) => void;
  onGoals: (g: Goal[]) => void;
  notif: NotificationSettings;
  onNotif: (n: NotificationSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const categories: GoalCategory[] = ["Все", "Маркетинг", "Продажи", "Продукт", "Работа", "Здоровье", "Спорт", "Личное"];
  const filtered = useMemo(() => (filter === "Все" ? goals : goals.filter((g) => g.category === filter)), [goals, filter]);

  function upsert(goal: Goal) {
    onGoals(goals.some((g) => g.id === goal.id) ? goals.map((g) => (g.id === goal.id ? goal : g)) : [goal, ...goals]);
    onNotif({ ...notif, perGoalEnabled: { ...notif.perGoalEnabled, [goal.id]: notif.perGoalEnabled[goal.id] ?? true } });
  }
  function remove(id: string) {
    onGoals(goals.filter((g) => g.id !== id));
    const map = { ...notif.perGoalEnabled };
    delete map[id];
    onNotif({ ...notif, perGoalEnabled: map });
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = goals.findIndex((g) => g.id === active.id);
    const newIndex = goals.findIndex((g) => g.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onGoals(arrayMove(goals, oldIndex, newIndex));
  }

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between">
        <Button variant="secondary" className="rounded-xl bg-[color:var(--primary)]/10 text-[color:var(--primary)] hover:bg-[color:var(--primary)]/15">
          <SlidersHorizontal className="size-4" />
          <span className="ml-2">Настроить вид</span>
        </Button>
        <div className="text-xs text-white/60">
          Обновлено: {new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      <div className="mt-4">
        <Card>
          <CardContent className="p-4 flex gap-3 items-start">
            <div className="mt-0.5 text-[color:var(--primary)]"><Quote className="size-5" /></div>
            <p className="text-sm italic text-white/70">Цитата дня: Успех — это сумма небольших усилий, повторяющихся изо дня в день.</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <Button
          onClick={() => { setEditing(null); setOpen(true); }}
          className="w-full rounded-2xl py-6 text-lg font-extrabold text-[#0b1b0b] bg-[color:var(--primary)] hover:bg-[color:var(--primary)]/90 shadow-lg shadow-[color:var(--primary)]/20"
        >
          <Plus className="size-5" />
          <span className="ml-2">Создать цель</span>
        </Button>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-lg font-extrabold tracking-tight">Категории</h3>
        <span className="text-[color:var(--primary)] text-sm font-extrabold">Фильтр</span>
      </div>

      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {categories.map((c) => {
          const active = filter === c;
          return (
            <button
              key={c}
              onClick={() => onFilter(c)}
              className={"shrink-0 h-10 px-5 rounded-xl font-extrabold text-sm border transition-colors " + (active ? "bg-[color:var(--primary)] text-[#0b1b0b] border-[color:var(--primary)]" : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10")}
            >
              {c}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-lg font-extrabold tracking-tight">Активные цели</h3>
        <div className="text-xs text-white/60">Drag & drop</div>
      </div>

      <div className="mt-3 pb-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={filtered.map((g) => g.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-3">
              {filtered.map((g) => (
                <GoalCard
                  key={g.id}
                  goal={g}
                  notifEnabled={notif.perGoalEnabled[g.id] ?? true}
                  onEdit={() => { setEditing(g); setOpen(true); }}
                  onDelete={() => remove(g.id)}
                />
              ))}
              {filtered.length === 0 && (
                <Card><CardContent className="p-4 text-sm text-white/60">В этой категории пока нет целей.</CardContent></Card>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <GoalDialog
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        initial={editing}
        onSave={(g) => { upsert(g); setOpen(false); setEditing(null); }}
      />
    </div>
  );
}

function GoalCard({
  goal, notifEnabled, onEdit, onDelete,
}: {
  goal: Goal;
  notifEnabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: goal.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const progress = goal.subtasks.length === 0 ? 0 : Math.min(95, 20 + goal.subtasks.length * 20);

  return (
    <div ref={setNodeRef} style={style}>
      <Card className={isDragging ? "ring-2 ring-[color:var(--primary)]/30" : ""}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3">
              <button className="mt-0.5 text-white/50 hover:text-white" {...attributes} {...listeners} aria-label="Перетащить">
                <GripVertical className="size-5" />
              </button>
              <div className="min-w-0">
                <div className="inline-flex items-center rounded-lg px-2 py-1 text-[10px] font-extrabold tracking-wider bg-black/30 text-[color:var(--primary)]">
                  {goal.category.toUpperCase()}
                </div>
                <div className="mt-2 text-base font-extrabold leading-snug truncate">{goal.title}</div>
                <div className="mt-2 flex items-center gap-2 text-xs text-white/60">
                  <Bell className="size-3.5" />
                  <span>{goal.reminderTime ?? "—"} · уведомления {notifEnabled ? "вкл" : "выкл"}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" size="icon" className="rounded-full bg-white/5 hover:bg-white/10" onClick={onEdit} aria-label="Редактировать">
                <Pencil className="size-4" />
              </Button>
              <Button variant="secondary" size="icon" className="rounded-full bg-white/5 hover:bg-white/10" onClick={onDelete} aria-label="Удалить">
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {goal.subtasks.slice(0, 3).map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-2xl px-3 py-2 border border-white/10 bg-black/10">
                <Circle className="size-4 text-white/40" />
                <div className="text-sm text-white/80 flex-1">{t.text}</div>
                <div className="text-[10px] font-extrabold text-white/60">{t.weight === "hard" ? "x2 XP" : "x1 XP"}</div>
              </div>
            ))}
            {goal.subtasks.length === 0 && <div className="text-sm text-white/50 italic">Подзадач пока нет</div>}
          </div>

          <div className="mt-4">
            <div className="flex items-end justify-between">
              <div className="text-[10px] uppercase tracking-wider font-extrabold text-white/40">Прогресс</div>
              <div className="text-sm font-extrabold text-[color:var(--primary)]">{progress}%</div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-[color:var(--primary)]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GoalDialog({
  open, onClose, initial, onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial: Goal | null;
  onSave: (g: Goal) => void;
}) {
  const isEdit = !!initial;
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Exclude<GoalCategory, "Все">>("Личное");
  const [reminderTime, setReminderTime] = useState("10:00");
  const [subtasks, setSubtasks] = useState<{ id: string; text: string; weight: "normal" | "hard" }[]>([]);
  const [newTask, setNewTask] = useState("");
  const [newWeight, setNewWeight] = useState<"normal" | "hard">("normal");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setTitle(initial.title);
      setCategory(initial.category);
      setReminderTime(initial.reminderTime ?? "10:00");
      setSubtasks(initial.subtasks);
    } else {
      setTitle("");
      setCategory("Личное");
      setReminderTime("10:00");
      setSubtasks([]);
    }
    setNewTask("");
    setNewWeight("normal");
  }, [open, initial]);

  function addTask() {
    const t = newTask.trim();
    if (!t) return;
    setSubtasks((s) => [...s, { id: uid("t"), text: t, weight: newWeight }]);
    setNewTask("");
    setNewWeight("normal");
  }

  function submit() {
    const t = title.trim();
    if (!t) return;
    onSave({
      id: initial?.id ?? uid("g"),
      title: t,
      category,
      reminderTime: reminderTime || undefined,
      subtasks,
    });
  }

  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать цель" : "Создать цель"}</DialogTitle>
          <DialogDescription>Цели задают структуру задач. Ежедневник автоматически подхватит подзадачи.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Название</Label>
            <Input value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="Например: Утренняя медитация" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Категория</Label>
              <select value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value as any)} className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm">
                {(["Маркетинг","Продажи","Продукт","Работа","Здоровье","Спорт","Личное"] as const).map((c) => (
                  <option key={c} value={c} style={{ background: "#0b1b0b" }}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Напоминание</Label>
              <Input value={reminderTime} onChange={(e) => setReminderTime((e.target as HTMLInputElement).value)} placeholder="10:00" />
            </div>
          </div>

          <div>
            <Label>Подзадачи</Label>
            <div className="mt-2 flex gap-2">
              <Input value={newTask} onChange={(e) => setNewTask((e.target as HTMLInputElement).value)} placeholder="Добавить подзадачу" />
              <select value={newWeight} onChange={(e) => setNewWeight((e.target as HTMLSelectElement).value as any)} className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm">
                <option value="normal" style={{ background: "#0b1b0b" }}>Обычная</option>
                <option value="hard" style={{ background: "#0b1b0b" }}>Сложная</option>
              </select>
              <Button className="bg-[color:var(--primary)] text-[#0b1b0b] hover:bg-[color:var(--primary)]/90" onClick={addTask}>
                <Plus className="size-4" />
              </Button>
            </div>

            <div className="mt-3 space-y-2">
              {subtasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                  <Circle className="size-4 text-white/40" />
                  <div className="flex-1 text-sm">{t.text}</div>
                  <div className="text-[10px] font-extrabold text-white/60">{t.weight === "hard" ? "x2" : "x1"}</div>
                  <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setSubtasks((s) => s.filter((x) => x.id !== t.id))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              {subtasks.length === 0 && <div className="text-sm text-white/50">Пока нет подзадач.</div>}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button className="bg-[color:var(--primary)] text-[#0b1b0b] hover:bg-[color:var(--primary)]/90" onClick={submit}>
            {isEdit ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Daily screen

type DayTask = { id: string; goalTitle: string; category: string; text: string; weight: "normal" | "hard" };

function DailyPlanner({ goals, entries, onEntries }: { goals: Goal[]; entries: DailyEntry[]; onEntries: (e: DailyEntry[]) => void }) {
  const [date, setDate] = useState(() => todayISO());
  const [editLayout, setEditLayout] = useState(false);
  const [blocks, setBlocks] = useState([
    { id: "calendar", title: "Календарь", visible: true },
    { id: "progress", title: "Прогресс за день", visible: true },
    { id: "quote", title: "Цитата дня", visible: true },
    { id: "tasks", title: "Основные цели", visible: true },
    { id: "notes", title: "Заметки", visible: true },
  ]);

  const dayTasks: DayTask[] = useMemo(() => {
    const out: DayTask[] = [];
    for (const g of goals) for (const t of g.subtasks) out.push({ id: `${g.id}::${t.id}`, goalTitle: g.title, category: g.category, text: t.text, weight: t.weight });
    return out;
  }, [goals]);

  const entry = useMemo(() => entries.find((e) => e.dateISO === date) ?? { dateISO: date, checks: {}, notes: "" }, [entries, date]);

  function commit(next: DailyEntry) {
    onEntries(entries.some((x) => x.dateISO === next.dateISO) ? entries.map((x) => (x.dateISO === next.dateISO ? next : x)) : [...entries, next].sort((a, b) => a.dateISO.localeCompare(b.dateISO)));
  }

  const doneCount = dayTasks.filter((t) => entry.checks[t.id]).length;
  const totalCount = dayTasks.length;
  const xpToday = dayTasks.reduce((acc, t) => acc + (entry.checks[t.id] ? (t.weight === "hard" ? 20 : 10) : 0), 0);

  const totalXP = useMemo(() => computeTotalXP(goals, entries), [goals, entries]);
  const lvl = useMemo(() => levelFromXP(totalXP), [totalXP]);
  const streak = useMemo(() => computeStreak(entries), [entries]);

  const quote = useMemo(() => {
    const quotes = [
      { q: "Секрет того, чтобы вырваться вперёд, в том, чтобы начать.", a: "Марк Твен" },
      { q: "Маленькие шаги каждый день создают большие результаты.", a: "Неизвестный" },
      { q: "Дисциплина — это свобода в маскировке.", a: "Неизвестный" },
    ];
    return quotes[Math.abs(hash(date)) % quotes.length];
  }, [date]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function onBlockDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setBlocks(arrayMove(blocks, oldIndex, newIndex));
  }

  function moveDate(delta: number) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(todayISO(d));
  }

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-full bg-white/5 hover:bg-white/10" onClick={() => moveDate(-1)}><ChevronLeft className="size-5" /></Button>
          <div>
            <div className="text-sm font-extrabold">Сегодня, {new Date(date + "T00:00:00").toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}</div>
            <div className="text-xs font-extrabold tracking-widest text-[color:var(--primary)]">ЕЖЕДНЕВНИК</div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full bg-white/5 hover:bg-white/10" onClick={() => setEditLayout((v) => !v)}><SlidersHorizontal className="size-5" /></Button>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
        <div className="text-sm font-extrabold tracking-wider text-[color:var(--primary)]">УПРАВЛЕНИЕ БЛОКАМИ</div>
        <Button className="rounded-full px-5 bg-[color:var(--primary)] text-[#0b1b0b] hover:bg-[color:var(--primary)]/90" onClick={() => setEditLayout((v) => !v)}>
          {editLayout ? "ГОТОВО" : "РЕДАКТИРОВАТЬ"}
        </Button>
      </div>

      {editLayout && (
        <div className="mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Настройка блоков</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <div className="text-xs text-white/60 mb-3">Перетаскивай блоки и скрывай ненужные.</div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onBlockDragEnd}>
                <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {blocks.map((b) => <BlockRow key={b.id} id={b.id} title={b.title} visible={b.visible} onToggle={() => setBlocks((x) => x.map((y) => y.id === b.id ? { ...y, visible: !y.visible } : y))} />)}
                  </div>
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {blocks.filter((b) => b.visible).map((b) => {
          if (b.id === "calendar") return (
            <Card key={b.id}>
              <CardHeader className="pb-2"><CardTitle className="text-base">Календарь</CardTitle></CardHeader>
              <CardContent className="pt-0"><MiniCalendar valueISO={date} onChange={setDate} /></CardContent>
            </Card>
          );

          if (b.id === "progress") return (
            <Card key={b.id}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-extrabold">Прогресс за день</div>
                  <div className="text-sm font-extrabold text-[color:var(--primary)]">{doneCount}/{totalCount} задач</div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-[color:var(--primary)]" style={{ width: `${totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100)}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-white/60">
                  <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">XP: <span className="text-white font-extrabold">{xpToday}</span></div>
                  <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 inline-flex items-center gap-1">
                    <Flame className="size-3.5 text-[color:var(--primary)]" /> Серия: <span className="text-white font-extrabold">{streak}</span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">Уровень: <span className="text-white font-extrabold">{lvl.level}</span></div>
                </div>
                <div className="mt-2 text-xs text-white/60">До следующего уровня: <span className="text-[color:var(--primary)] font-extrabold">{lvl.nextNeed - lvl.progress} XP</span></div>
              </CardContent>
            </Card>
          );

          if (b.id === "quote") return (
            <Card key={b.id} className="border-[color:var(--primary)]/15">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-[color:var(--primary)] font-extrabold tracking-wider"><Quote className="size-5" /> ЦИТАТА ДНЯ</div>
                <div className="mt-3 text-lg italic text-white/80">“{quote.q}”</div>
                <div className="mt-2 text-[color:var(--primary)] font-extrabold">— {quote.a}</div>
              </CardContent>
            </Card>
          );

          if (b.id === "tasks") return (
            <Card key={b.id}>
              <CardHeader className="pb-2"><CardTitle className="text-base">Основные цели</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {dayTasks.length === 0 ? (
                  <div className="text-sm text-white/60">Нет задач. Создай цель и подзадачи на экране «Цели».</div>
                ) : (
                  <div className="space-y-3">
                    {dayTasks.map((t) => {
                      const done = !!entry.checks[t.id];
                      return (
                        <button
                          key={t.id}
                          className={"w-full text-left flex items-start gap-3 rounded-2xl border px-4 py-4 transition-colors " + (done ? "border-[color:var(--primary)]/25 bg-[color:var(--primary)]/5" : "border-white/10 bg-black/10 hover:bg-white/5")}
                          onClick={() => commit({ ...entry, checks: { ...entry.checks, [t.id]: !done } })}
                        >
                          {done ? <CheckCircle2 className="size-6 text-[color:var(--primary)]" /> : <Circle className="size-6 text-white/30" />}
                          <div className="flex-1">
                            <div className={"text-base font-extrabold " + (done ? "line-through opacity-70" : "")}>{t.goalTitle}</div>
                            <div className="mt-1 text-sm text-white/70">{t.text}</div>
                            <div className="mt-2 text-xs text-white/60">{t.category} · {t.weight === "hard" ? "+20 XP" : "+10 XP"}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );

          if (b.id === "notes") return (
            <Card key={b.id}>
              <CardHeader className="pb-2"><CardTitle className="text-base">Заметки</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <Textarea value={entry.notes} onChange={(e) => commit({ ...entry, notes: (e.target as HTMLTextAreaElement).value })} placeholder="Коротко: что получилось, что мешало, что улучшить…" className="min-h-[110px]" />
              </CardContent>
            </Card>
          );

          return null;
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="icon" className="rounded-full bg-white/5 hover:bg-white/10" onClick={() => moveDate(1)} aria-label="Следующий день">
          <ChevronRight className="size-5" />
        </Button>
      </div>
    </div>
  );
}

function BlockRow({ id, title, visible, onToggle }: { id: string; title: string; visible: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/10 px-3 py-2">
      <button className="text-white/50 hover:text-white" {...attributes} {...listeners}><GripVertical className="size-4" /></button>
      <div className="flex-1 text-sm font-extrabold">{title}</div>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-white/60">Показ</Label>
        <Switch checked={visible} onCheckedChange={onToggle} />
      </div>
    </div>
  );
}

function MiniCalendar({ valueISO, onChange }: { valueISO: string; onChange: (iso: string) => void }) {
  const d = new Date(valueISO + "T00:00:00");
  const year = d.getFullYear();
  const month = d.getMonth();

  const first = new Date(year, month, 1);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  function toISO(day: number) { const dd = new Date(year, month, day); return todayISO(dd); }

  return (
    <div>
      <div className="flex items-center justify-between mb-2"><div className="text-sm font-extrabold capitalize">{monthLabel}</div></div>
      <div className="grid grid-cols-7 gap-1 text-xs text-white/50">
        {["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((w) => <div key={w} className="text-center py-1 font-extrabold">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1 mt-1">
        {cells.map((day, idx) => {
          const active = day != null && toISO(day) === valueISO;
          return (
            <button
              key={idx}
              disabled={day == null}
              onClick={() => day != null && onChange(toISO(day))}
              className={"h-9 rounded-2xl text-sm font-extrabold border transition-colors " + (day == null ? "opacity-0" : active ? "bg-[color:var(--primary)] text-[#0b1b0b] border-[color:var(--primary)]" : "bg-black/10 hover:bg-white/5 border-white/10 text-white/80")}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Stats screen

function Stats({ goals, entries, widgets, onWidgets }: { goals: Goal[]; entries: DailyEntry[]; widgets: Widget[]; onWidgets: (w: Widget[]) => void }) {
  const [range, setRange] = useState<"week" | "month" | "year">("week");

  const series = useMemo(() => {
    const now = new Date();
    const days = range === "week" ? 7 : range === "month" ? 30 : 365;
    const map = new Map(entries.map((e) => [e.dateISO, e]));
    const keys = getAllTaskKeys(goals);
    const out: { date: string; pct: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = todayISO(d);
      const e = map.get(iso);
      const total = keys.length;
      let done = 0;
      if (e) for (const k of keys) if (e.checks[k]) done += 1;
      const pct = total === 0 ? 0 : Math.round((done / total) * 100);
      out.push({ date: iso.slice(5), pct });
    }
    return out;
  }, [entries, goals, range]);

  const pctNow = series[series.length - 1]?.pct ?? 0;

  function addWidget(kind: WidgetKind) {
    onWidgets([...widgets, { id: uid("w"), kind, chartType: kind === "chart" ? "line" : undefined }]);
  }
  function removeWidget(id: string) { onWidgets(widgets.filter((w) => w.id !== id)); }
  function toggleChartType(id: string) {
    onWidgets(widgets.map((w) => w.id === id ? { ...w, chartType: w.chartType === "line" ? "bar" : "line" } : w));
  }

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between">
        <div className="text-lg font-extrabold">Статистика</div>
        <Button variant="ghost" size="icon" className="rounded-full bg-white/5 hover:bg-white/10"><SettingsIcon className="size-5" /></Button>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-[var(--carddark)] p-5">
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ name: "done", value: pctNow }]} startAngle={90} endAngle={-270}>
              <RadialBar dataKey="value" cornerRadius={16} fill={TOKENS.primary} />
              <Tooltip />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <div className="-mt-28 text-center">
          <div className="text-5xl font-extrabold">{pctNow}%</div>
          <div className="text-[color:var(--primary)] font-extrabold tracking-wider">ДОСТИГНУТО</div>
        </div>

        <div className="mt-6 flex justify-center">
          <div className="inline-flex rounded-xl border border-white/10 bg-black/10 p-1">
            {([{ k: "week", label: "Неделя" }, { k: "month", label: "Месяц" }, { k: "year", label: "Год" }] as const).map((x) => {
              const active = range === x.k;
              return (
                <button key={x.k} onClick={() => setRange(x.k)} className={"px-4 py-2 rounded-lg text-sm font-extrabold transition-colors " + (active ? "bg-[color:var(--primary)] text-[#0b1b0b]" : "text-white/60 hover:text-white")}>
                  {x.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        <Button variant="secondary" className="rounded-xl bg-white/5 text-white hover:bg-white/10" onClick={() => addWidget("heatmap")}>+ Теплокарта</Button>
        <Button variant="secondary" className="rounded-xl bg-white/5 text-white hover:bg-white/10" onClick={() => addWidget("chart")}>+ График</Button>
        <Button variant="secondary" className="rounded-xl bg-white/5 text-white hover:bg-white/10" onClick={() => addWidget("streak")}>+ Серии</Button>
      </div>

      <div className="mt-3 space-y-3">
        {widgets.map((w) => (
          <Card key={w.id}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">{w.kind === "heatmap" ? "Карта активности" : w.kind === "chart" ? "График выполнения" : "Счётчик серий"}</CardTitle>
              <div className="flex items-center gap-2">
                {w.kind === "chart" && (
                  <Button variant="secondary" className="rounded-xl bg-white/5 text-white hover:bg-white/10" onClick={() => toggleChartType(w.id)}>
                    {w.chartType === "line" ? "Линейный" : "Столбчатый"}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="rounded-full bg-white/5 hover:bg-white/10" onClick={() => removeWidget(w.id)}><Trash2 className="size-4" /></Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {w.kind === "heatmap" && <Heatmap entries={entries} goals={goals} />}
              {w.kind === "chart" && <ProgressChart data={series} type={w.chartType ?? "line"} />}
              {w.kind === "streak" && <StreakWidget entries={entries} />}
            </CardContent>
          </Card>
        ))}
        {widgets.length === 0 && <Card><CardContent className="p-4 text-sm text-white/60">Нет виджетов. Добавь один выше.</CardContent></Card>}
      </div>
    </div>
  );
}

function ProgressChart({ data, type }: { data: any[]; type: "line" | "bar" }) {
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        {type === "line" ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Line type="monotone" dataKey="pct" strokeWidth={2} />
          </LineChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="pct" />
          </BarChart>
        )}
      </ResponsiveContainer>
      <div className="mt-2 text-xs text-white/60">Показан % выполненных задач в день.</div>
    </div>
  );
}

function Heatmap({ entries, goals }: { entries: DailyEntry[]; goals: Goal[] }) {
  const days = 70;
  const map = new Map(entries.map((e) => [e.dateISO, e]));
  const taskKeys = getAllTaskKeys(goals);

  const cells = useMemo(() => {
    const out: { iso: string; pct: number }[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = todayISO(d);
      const e = map.get(iso);
      let done = 0;
      if (e) for (const k of taskKeys) if (e.checks[k]) done += 1;
      const pct = taskKeys.length === 0 ? 0 : done / taskKeys.length;
      out.push({ iso, pct });
    }
    return out;
  }, [entries, goals]);

  const cellClass = (pct: number) => {
    if (pct === 0) return "bg-white/10";
    if (pct < 0.34) return "bg-white/25";
    if (pct < 0.67) return "bg-white/40";
    return "bg-[color:var(--primary)]/70";
  };

  return (
    <div>
      <div className="grid grid-cols-10 gap-1">
        {cells.map((c) => (
          <div key={c.iso} title={`${c.iso}: ${Math.round(c.pct * 100)}%`} className={"h-6 rounded-lg " + cellClass(c.pct)} />
        ))}
      </div>
      <div className="mt-2 text-xs text-white/60">Последние 70 дней (чем ярче — тем больше выполнено).</div>
    </div>
  );
}

function StreakWidget({ entries }: { entries: DailyEntry[] }) {
  const streak = computeStreak(entries);
  return (
    <div className="flex items-center gap-3">
      <div className="size-12 rounded-2xl border border-white/10 bg-black/10 grid place-items-center">
        <Flame className="size-6 text-[color:var(--primary)]" />
      </div>
      <div>
        <div className="text-sm font-extrabold">Текущая серия</div>
        <div className="text-2xl font-extrabold tracking-tight">{streak} дней</div>
        <div className="text-xs text-white/60">Награды: 7 / 30 / 100</div>
      </div>
    </div>
  );
}

// Settings screen

function Settings({
  theme, onTheme, notif, goals, onNotif, onReset,
}: {
  theme: ThemeMode;
  onTheme: (t: ThemeMode) => void;
  notif: NotificationSettings;
  goals: Goal[];
  onNotif: (n: NotificationSettings) => void;
  onReset: () => void;
}) {
  return (
    <div className="px-4 pt-4 space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Тема</CardTitle></CardHeader>
        <CardContent className="pt-0 flex items-center justify-between">
          <div>
            <div className="text-sm font-extrabold">Светлая / Тёмная</div>
            <div className="text-xs text-white/60">В этом MVP основной стиль — тёмный</div>
          </div>
          <Switch checked={theme === "dark"} onCheckedChange={(v) => onTheme(v ? "dark" : "light")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Уведомления</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-4">
          <RowToggle title="Включить уведомления" desc="Глобальный переключатель" checked={notif.enabled} onChange={(v) => onNotif({ ...notif, enabled: v })} />
          <RowToggle title="Утренний брифинг" desc={`Время: ${notif.morningTime}`} checked={notif.morningBriefEnabled} onChange={(v) => onNotif({ ...notif, morningBriefEnabled: v })} />
          <RowToggle title="Вечерний отчёт" desc={`Время: ${notif.eveningTime}`} checked={notif.eveningReportEnabled} onChange={(v) => onNotif({ ...notif, eveningReportEnabled: v })} />

          <Card className="bg-black/10">
            <CardContent className="p-4 space-y-3">
              <RowToggle title="Тихий режим" desc={`${notif.quietFrom} — ${notif.quietTo}`} checked={notif.quietHoursEnabled} onChange={(v) => onNotif({ ...notif, quietHoursEnabled: v })} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-white/60">С</Label>
                  <Input value={notif.quietFrom} onChange={(e) => onNotif({ ...notif, quietFrom: (e.target as HTMLInputElement).value })} />
                </div>
                <div>
                  <Label className="text-white/60">До</Label>
                  <Input value={notif.quietTo} onChange={(e) => onNotif({ ...notif, quietTo: (e.target as HTMLInputElement).value })} />
                </div>
              </div>
            </CardContent>
          </Card>

          <RowToggle title="Напоминания по целям" desc="Время задаётся в карточке цели" checked={notif.goalRemindersEnabled} onChange={(v) => onNotif({ ...notif, goalRemindersEnabled: v })} />
          <div className="space-y-2">
            {goals.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-3 rounded-xl bg-black/10 px-3 py-2 border border-white/10">
                <div className="min-w-0">
                  <div className="text-sm font-extrabold truncate">{g.title}</div>
                  <div className="text-xs text-white/60">{g.reminderTime ?? "—"}</div>
                </div>
                <Switch checked={notif.perGoalEnabled[g.id] ?? true} onCheckedChange={(v) => onNotif({ ...notif, perGoalEnabled: { ...notif.perGoalEnabled, [g.id]: v } })} />
              </div>
            ))}
            {goals.length === 0 && <div className="text-sm text-white/60">Нет целей.</div>}
          </div>

          <Card className="bg-black/10">
            <CardContent className="p-4">
              <div className="text-sm font-extrabold">Важно</div>
              <div className="text-xs text-white/60 mt-1">
                В веб-версии настройки сохраняются локально. В мобильной версии эти параметры подключаются к local/push уведомлениям.
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Данные</CardTitle></CardHeader>
        <CardContent className="pt-0 flex items-center justify-between">
          <div>
            <div className="text-sm font-extrabold">Сбросить</div>
            <div className="text-xs text-white/60">Удалить цели и прогресс (localStorage)</div>
          </div>
          <Button variant="secondary" className="rounded-xl bg-white/10 hover:bg-white/15" onClick={onReset}>Сброс</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function RowToggle({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-extrabold">{title}</div>
        <div className="text-xs text-white/60">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// ---------------- Auth + Supabase Sync (email/password) ----------------

type SessionUser = { id: string; email?: string | null };

async function loadRemoteState(userId: string): Promise<AppState | null> {
  const { data, error } = await supabase.from("app_state").select("data").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (data.data ?? null) as AppState | null;
}

async function saveRemoteState(userId: string, state: AppState): Promise<void> {
  const payload = { user_id: userId, data: state, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("app_state").upsert(payload, { onConflict: "user_id" });
  if (error) throw error;
}

function AuthGate() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const u = data.session?.user;
      setUser(u ? { id: u.id, email: u.email } : null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email } : null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center bg-[var(--bgdarker,#0b1b0b)] text-white">
        <div className="w-full max-w-[430px] bg-[var(--bgdark,#102210)] border border-white/10 rounded-2xl p-6 text-center">
          <div className="text-lg font-extrabold">Загрузка…</div>
          <div className="mt-2 text-sm text-white/60">Подключаемся к Supabase</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center bg-[var(--bgdarker,#0b1b0b)] text-white">
        <div className="w-full max-w-[430px] bg-[var(--bgdark,#102210)] border border-white/10 rounded-2xl p-6">
          <div className="text-2xl font-extrabold">GoalAdmin & Tracker</div>
          <div className="mt-1 text-sm text-white/60">Вход по email и паролю. Данные синхронизируются.</div>

          <div className="mt-5 flex gap-2">
            <button onClick={() => { setMode("signin"); setErr(null); }} className={"flex-1 h-10 rounded-xl font-extrabold border " + (mode==="signin" ? "bg-[color:var(--primary)] text-[#0b1b0b] border-[color:var(--primary)]" : "bg-white/5 border-white/10 text-white/70")}>
              Вход
            </button>
            <button onClick={() => { setMode("signup"); setErr(null); }} className={"flex-1 h-10 rounded-xl font-extrabold border " + (mode==="signup" ? "bg-[color:var(--primary)] text-[#0b1b0b] border-[color:var(--primary)]" : "bg-white/5 border-white/10 text-white/70")}>
              Регистрация
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail((e.target as HTMLInputElement).value)} placeholder="you@example.com" />
            </div>
            <div className="space-y-2">
              <Label>Пароль</Label>
              <Input type="password" value={password} onChange={(e) => setPassword((e.target as HTMLInputElement).value)} placeholder="••••••••" />
              <div className="text-xs text-white/50">Минимум 6 символов.</div>
            </div>

            {err && <div className="text-sm text-red-300">{err}</div>}

            <Button
              className="w-full rounded-2xl py-6 text-lg font-extrabold text-[#0b1b0b] bg-[color:var(--primary)] hover:bg-[color:var(--primary)]/90"
              onClick={async () => {
                setErr(null);
                try {
                  if (!email.trim() || !password.trim()) { setErr("Заполни email и пароль."); return; }
                  if (mode === "signup") {
                    const { error } = await supabase.auth.signUp({ email: email.trim(), password: password.trim() });
                    if (error) throw error;
                    setErr("Проверь почту: иногда Supabase требует подтверждение email.");
                  } else {
                    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
                    if (error) throw error;
                  }
                } catch (e: any) {
                  setErr(e?.message ?? "Ошибка входа");
                }
              }}
            >
              {mode === "signin" ? "Войти" : "Создать аккаунт"}
            </Button>
          </div>

          <div className="mt-4 text-xs text-white/50">
            Если вход не работает — проверь, что в Vercel/локально добавлены переменные окружения Supabase (VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY).
          </div>
        </div>
      </div>
    );
  }

  return <MainAppWithCloud user={user} />;
}

function MainAppWithCloud({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>("admin");
  const [state, setState] = useState<AppState>(() => loadState()); // fallback local default
  const [cloudStatus, setCloudStatus] = useState<"loading"|"ready"|"saving"|"error">("loading");
  const [cloudError, setCloudError] = useState<string | null>(null);

  const saveTimer = useRef<number | null>(null);
  const firstLoaded = useRef(false);

  // initial fetch from cloud
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setCloudStatus("loading");
        const remote = await loadRemoteState(user.id);
        if (!alive) return;
        if (remote) {
          setState(remote);
        } else {
          // seed cloud with local default
          await saveRemoteState(user.id, state);
        }
        firstLoaded.current = true;
        setCloudStatus("ready");
      } catch (e: any) {
        if (!alive) return;
        setCloudStatus("error");
        setCloudError(e?.message ?? "Не удалось загрузить данные из облака");
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  // localStorage backup
  useEffect(() => saveState(state), [state]);
  useEffect(() => { document.documentElement.style.setProperty("--primary", TOKENS.primary); }, []);

  // debounce cloud save
  useEffect(() => {
    if (!firstLoaded.current) return;
    if (cloudStatus === "loading") return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        setCloudStatus("saving");
        await saveRemoteState(user.id, state);
        setCloudStatus("ready");
      } catch (e: any) {
        setCloudStatus("error");
        setCloudError(e?.message ?? "Не удалось сохранить в облако");
      }
    }, 600);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [state, user.id]);

  // Ensure per-goal toggles exist (same logic as before)
  useEffect(() => {
    setState((s) => {
      const map = { ...s.notification.perGoalEnabled };
      let changed = false;
      for (const g of s.goals) {
        if (map[g.id] === undefined) { map[g.id] = true; changed = true; }
      }
      for (const k of Object.keys(map)) {
        if (!s.goals.some((g) => g.id === k)) { delete map[k]; changed = true; }
      }
      return changed ? { ...s, notification: { ...s.notification, perGoalEnabled: map } } : s;
    });
  }, [state.goals.length]);

  return (
    <div className="min-h-[100dvh] w-full flex justify-center bg-[var(--bgdarker,#0b1b0b)] text-white">
      <div className="w-full max-w-[430px] min-h-[100dvh] bg-[var(--bgdark,#102210)] shadow-2xl overflow-hidden relative">
        <header className="sticky top-0 z-50 border-b border-white/10 bg-[var(--bgdark,#102210)]/90 backdrop-blur">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="size-10 rounded-full border-2 border-[color:var(--primary)]/30 bg-black/20 grid place-items-center">
              <LayoutDashboard className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-extrabold tracking-tight leading-tight truncate">GoalAdmin & Tracker</div>
              <div className="text-xs text-white/60 truncate">{user.email ?? "Аккаунт"} · {cloudStatus === "saving" ? "сохранение…" : cloudStatus === "ready" ? "синхронизировано" : cloudStatus === "loading" ? "загрузка…" : "ошибка синхронизации"}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full bg-white/5 hover:bg-white/10"
              onClick={async () => { await supabase.auth.signOut(); }}
              aria-label="Выйти"
              title="Выйти"
            >
              <SettingsIcon className="size-5" />
            </Button>
          </div>
          {cloudStatus === "error" && cloudError && (
            <div className="px-4 pb-3 text-xs text-red-300">{cloudError}</div>
          )}
        </header>

        <main className="pb-24">
          {tab === "admin" && (
            <AdminDashboard
              goals={state.goals}
              filter={state.adminCategoryFilter}
              onFilter={(f) => setState((s) => ({ ...s, adminCategoryFilter: f }))}
              notif={state.notification}
              onGoals={(goals) => setState((s) => ({ ...s, goals }))}
              onNotif={(notification) => setState((s) => ({ ...s, notification }))}
            />
          )}
          {tab === "daily" && (
            <DailyPlanner
              goals={state.goals}
              entries={state.entries}
              onEntries={(entries) => setState((s) => ({ ...s, entries }))}
            />
          )}
          {tab === "stats" && (
            <Stats
              goals={state.goals}
              entries={state.entries}
              widgets={state.widgets}
              onWidgets={(widgets) => setState((s) => ({ ...s, widgets }))}
            />
          )}
          {tab === "settings" && (
            <Settings
              theme={state.theme}
              onTheme={(theme) => setState((s) => ({ ...s, theme }))}
              notif={state.notification}
              goals={state.goals}
              onNotif={(notification) => setState((s) => ({ ...s, notification }))}
              onReset={() => {
                localStorage.removeItem(STORAGE_KEY);
                const next = loadState();
                setState(next);
                setTab("admin");
                // also wipe cloud
                saveRemoteState(user.id, next).catch(() => {});
              }}
            />
          )}
        </main>
        <BottomNav tab={tab} onTab={setTab} />
      </div>
    </div>
  );
}

// Export AuthGate as the app entry
export default function App() {
  return <AuthGate />;
}
