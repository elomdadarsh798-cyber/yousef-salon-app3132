import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  LayoutDashboard, ShoppingCart, Scissors, Users, Calendar, Package,
  Wallet, FileBarChart, Settings as SettingsIcon, Plus, Trash2, Pencil,
  Search, X, Printer, Sun, Moon, ChevronRight, Phone, Star, Download,
  AlertTriangle, Check, Clock, TrendingUp, DollarSign, Receipt, UserCog,
  LogIn, LogOut, KeyRound, Banknote, Bell,
} from "lucide-react";
import { doc, getDoc, onSnapshot, setDoc, deleteDoc, collection, query, orderBy, runTransaction } from "firebase/firestore";
import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecondary } from "firebase/auth";
import { db, firebaseConfig } from "./firebase";
import { logout, staffLoginEmail } from "./Login.jsx";

/* ============================== FONTS / THEME ============================== */
const FontStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&family=Cairo:wght@400;500;600;700;800&display=swap');
    * { font-family: 'Cairo', 'Inter', sans-serif; }
    .display-font { font-family: 'Bebas Neue', 'Cairo', sans-serif; letter-spacing: 0.03em; }
    .stripe-divider {
      height: 4px; width: 100%; border-radius: 4px;
      background: repeating-linear-gradient(135deg, #C6A15B 0px, #C6A15B 10px, #7A1F1F 10px, #7A1F1F 20px, #EDE6DA 20px, #EDE6DA 30px);
      opacity: 0.9;
    }
    .scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: #3a322a; border-radius: 4px; }
    @media print {
      body * { visibility: hidden; }
      #receipt-print, #receipt-print * { visibility: visible; }
      #receipt-print { position: fixed; top: 0; left: 0; width: 80mm; }
    }
  `}</style>
);

const THEMES = {
  dark: {
    bg: "#0B0A09", surface: "#161210", surface2: "#1F1A15", border: "#2C2419",
    text: "#F3EDE3", muted: "#9C9284", gold: "#C6A15B", goldSoft: "#E4C98A",
    red: "#9A2C2C", green: "#4C7A5A", input: "#211B16",
  },
  light: {
    bg: "#F5F1E8", surface: "#FFFFFF", surface2: "#F0E9DA", border: "#E1D6C0",
    text: "#241E17", muted: "#7A6F5E", gold: "#9A7B2F", goldSoft: "#B99544",
    red: "#8B2020", green: "#2F6B47", input: "#FBF8F1",
  },
};

const EGP = (n) => `${(Number(n) || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج.م`;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayISO = () => new Date().toISOString().slice(0, 10);

const distanceMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// بيحسب فرق ساعات العمل عن الشفت المعياري للموظف اللي بياخد راتب يومي ثابت
function computeDailyWageAdjustment(s, checkInISO, checkOutISO) {
  if (!s || s.payType !== "daily" || !s.dailyWage || !s.standardHours) return null;
  const hours = (new Date(checkOutISO) - new Date(checkInISO)) / 3600000;
  const diff = hours - s.standardHours;
  if (Math.abs(diff) < 0.05) return null;
  const hourlyRate = s.dailyWage / s.standardHours;
  const amount = Math.round(Math.abs(diff) * hourlyRate);
  if (amount <= 0) return null;
  return {
    hoursWorked: Math.round(hours * 100) / 100,
    standardHours: s.standardHours,
    diffHours: Math.round(diff * 100) / 100,
    amount,
    type: diff < 0 ? "deduction" : "bonus",
  };
}
function verifyShopLocation(settingsData) {
  return new Promise((resolve, reject) => {
    if (!settingsData?.shopLat || !settingsData?.shopLng) { resolve(); return; } // المحل لسه محددش موقعه، متخطاش الفحص
    if (!navigator.geolocation) { reject("الجهاز ده مش بيدعم تحديد الموقع"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const d = distanceMeters(pos.coords.latitude, pos.coords.longitude, settingsData.shopLat, settingsData.shopLng);
        if (d <= (settingsData.shopRadius || 100)) resolve();
        else reject(`لازم تكوني في المحل عشان تسجلي حضور (انتِ على بعد ${Math.round(d)} متر منه)`);
      },
      () => reject("لازم تفعّلي صلاحية الموقع (GPS) من المتصفح عشان تسجلي حضور"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}
const slotKey = (staffId, date, time) => `${staffId}_${date}_${time}`.replace(/[^a-zA-Z0-9_-]/g, "");
const fmtDate = (d) => new Date(d).toLocaleDateString("ar-EG", { day: "2-digit", month: "short", year: "numeric" });
const fmtTime = (d) => new Date(d).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });

/* ============================== SMART QUEUE SYSTEM (no time slots) ============================== */
// Queue statuses, forward order. Booking is instant (customer gets a queue
// number right away) — there's no "pending approval" step in this model.
const Q_STATUS = {
  WAITING: "waiting", ON_THE_WAY: "on_the_way", ARRIVED: "arrived", CALLED: "called",
  IN_SERVICE: "in_service", COMPLETED: "completed", CANCELLED: "cancelled", NO_SHOW: "no_show",
};
const Q_STATUS_LABEL = {
  waiting: "في الانتظار", on_the_way: "في الطريق", arrived: "وصل الصالون", called: "تم استدعاؤه",
  in_service: "جاري تنفيذ الخدمة", completed: "مكتمل", cancelled: "ملغي", no_show: "لم يحضر",
};
const Q_ACTIVE_STATUSES = [Q_STATUS.WAITING, Q_STATUS.ON_THE_WAY, Q_STATUS.ARRIVED, Q_STATUS.CALLED, Q_STATUS.IN_SERVICE];
const Q_TERMINAL_STATUSES = [Q_STATUS.COMPLETED, Q_STATUS.CANCELLED, Q_STATUS.NO_SHOW];
const DEFAULT_PERIODS = [
  { key: "morning", label: "الصباح", startHour: 9, endHour: 12 },
  { key: "noon", label: "الظهر", startHour: 12, endHour: 15 },
  { key: "afternoon", label: "العصر", startHour: 15, endHour: 18 },
  { key: "evening", label: "المساء", startHour: 18, endHour: 22 },
];

// Learn a rolling average duration (minutes) per staff+service from actually
// completed queue entries. Used ONLY for waiting-time estimates — never to
// build fixed time slots.
function updateDurationStats(stats, staffId, serviceId, actualMinutes) {
  if (!staffId || !serviceId || !actualMinutes || actualMinutes <= 0 || actualMinutes > 6 * 60) return stats;
  const next = { ...stats };
  const forStaff = { ...(next[staffId] || {}) };
  const prev = forStaff[serviceId] || { avgMin: actualMinutes, count: 0 };
  const count = prev.count + 1;
  const avgMin = Math.round(((prev.avgMin * prev.count) + actualMinutes) / count);
  forStaff[serviceId] = { avgMin, count };
  next[staffId] = forStaff;
  return next;
}

// Mirrors a finished queue entry into the customer's personal history
// document — the same document the customer app's "My Bookings" page reads.
async function mirrorQueueEntryToHistory(entry) {
  if (!entry?.customerPhone) return;
  try {
    const ref = doc(db, "customerBookings", entry.customerPhone);
    const snap = await getDoc(ref);
    const current = snap.exists() ? snap.data().bookings || [] : [];
    const idx = current.findIndex((b) => b.id === entry.id);
    const updated = idx >= 0 ? current.map((b, i) => (i === idx ? { ...b, ...entry } : b)) : [...current, entry];
    await setDoc(ref, { name: entry.customerName || snap.data()?.name || "", bookings: updated.slice(-50) });
  } catch (e) {}
}

// Keeps the bp_queue document small over time: entries from previous days,
// or entries that finished more than a few minutes ago, are archived into
// the customer's own history doc and dropped from the live queue list.
function pruneTerminalEntries(list) {
  const today = todayISO();
  const cutoff = Date.now() - 5 * 60 * 1000;
  const keep = [];
  const toArchive = [];
  for (const e of list) {
    const isOld = e.date !== today;
    const doneRecently = Q_TERMINAL_STATUSES.includes(e.status) && (e.updated_at || 0) < cutoff;
    if (Q_TERMINAL_STATUSES.includes(e.status) && (isOld || doneRecently)) toArchive.push(e);
    else keep.push(e);
  }
  return { keep, toArchive };
}

/* ============================== STORAGE HOOK (Firebase Firestore) ============================== */
// كل قيمة بتتخزن في مستند واحد داخل مجموعة "barberpro" على Firestore.
// أي جهاز (موبايل أو كمبيوتر) بيفتح نفس مشروع Firebase هيشوف نفس البيانات لحظيًا.
function usePersistentState(key, seedFactory) {
  const [data, setData] = useState(null);
  const loaded = useRef(false);
  const skipNextWrite = useRef(false);

  useEffect(() => {
    loaded.current = false;
    const ref = doc(db, "barberpro", key);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists() && snap.data().value !== undefined) {
          skipNextWrite.current = true;
          setData(snap.data().value);
        } else {
          // أول مرة يتشغل فيها المشروع على هذا المستند: لسه مفيش داتا خالص
          // في Firestore، فده الوقت الوحيد المسموح فيه بإنشاء قيمة افتراضية.
          const seed = seedFactory();
          setDoc(ref, { value: seed }).catch(() => {});
          setData(seed);
        }
        loaded.current = true;
      },
      () => {
        // مهم جدًا: هذا الفرع بيتنفذ لو حصل خطأ في المستمع (مثلاً فصل نت
        // مؤقت أو مشكلة صلاحيات) — وليس بالضرورة "المستند فاضي". أي داتا
        // سبق تحميلها في `data` (state) تفضل زي ما هي بدون أي تغيير، ومفيش
        // أي setDoc هنا خالص. فشل الاتصال لا يجب أبدًا أن يعني "امسح
        // البيانات أو استبدلها ببيانات افتراضية" — ده كان بالظبط سبب فقدان
        // بيانات حقيقية قبل كده: كانت بتتكتب بيانات فاضية/افتراضية فوق
        // آخر نسخة حقيقية بمجرد ما الاتصال يهتز. لو دي أول تحميلة للتطبيق
        // وحصل الخطأ قبل أي بيانات، هيفضل `data` null و`loaded` false —
        // يعني الشاشة تفضل "بيتحمل" لحد ما الاتصال يرجع، بدل ما تفتح
        // ببيانات فاضية وهمية.
      }
    );
    return () => unsub();
  }, [key]);

  useEffect(() => {
    if (!loaded.current || data === null) return;
    if (skipNextWrite.current) { skipNextWrite.current = false; return; }
    const ref = doc(db, "barberpro", key);
    setDoc(ref, { value: data }).catch(() => {});
  }, [data, key]);

  return [data, setData];
}

/* ============================== SMALL UI PARTS ============================== */
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        className="w-full rounded-2xl overflow-hidden shadow-2xl scrollbar-thin"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", maxWidth: wide ? 720 : 460, maxHeight: "88vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="display-font text-2xl" style={{ color: "var(--gold)" }}>{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: "var(--muted)" }}><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="block mb-1 text-sm" style={{ color: "var(--muted)" }}>{label}</span>
      {children}
    </label>
  );
}
const inputStyle = { background: "var(--input)", border: "1px solid var(--border)", color: "var(--text)" };
function TextInput(props) {
  return <input {...props} className={"w-full rounded-lg px-3 py-2 outline-none text-sm " + (props.className || "")} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function Select(props) {
  return <select {...props} className={"w-full rounded-lg px-3 py-2 outline-none text-sm " + (props.className || "")} style={{ ...inputStyle, ...(props.style || {}) }}>{props.children}</select>;
}
function Btn({ children, onClick, variant = "solid", className = "", type = "button", disabled }) {
  const base = "px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 justify-center transition disabled:opacity-40";
  const style =
    variant === "solid" ? { background: "var(--gold)", color: "#141210" } :
    variant === "danger" ? { background: "var(--red)", color: "#fff" } :
    variant === "ghost" ? { background: "transparent", color: "var(--text)", border: "1px solid var(--border)" } :
    { background: "var(--surface2)", color: "var(--text)" };
  return <button type={type} disabled={disabled} onClick={onClick} className={base + " " + className} style={style}>{children}</button>;
}
function StatCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: "var(--muted)" }}>{label}</span>
        <div className="p-2 rounded-lg" style={{ background: accent ? "rgba(198,161,91,0.15)" : "var(--surface2)" }}>
          <Icon size={16} style={{ color: "var(--gold)" }} />
        </div>
      </div>
      <div className="display-font text-3xl" style={{ color: "var(--text)" }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}
function Badge({ children, tone = "default" }) {
  const map = {
    default: { bg: "var(--surface2)", c: "var(--muted)" },
    gold: { bg: "rgba(198,161,91,0.18)", c: "var(--gold)" },
    green: { bg: "rgba(76,122,90,0.2)", c: "#8FCB9F" },
    red: { bg: "rgba(154,44,44,0.2)", c: "#E38686" },
  };
  const s = map[tone];
  return <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.c }}>{children}</span>;
}
function Empty({ text }) {
  return <div className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>{text}</div>;
}

const ROLE_LABELS = { owner: "صاحب المحل", manager: "مدير", cashier: "موظف / كاشير", barber: "حلاق" };

/* ============================== APP ============================== */
export default function BarberPro({ user }) {
  const [theme, setTheme] = useState("dark");
  const T = THEMES[theme];
  const cssVars = {
    "--bg": T.bg, "--surface": T.surface, "--surface2": T.surface2, "--border": T.border,
    "--text": T.text, "--muted": T.muted, "--gold": T.gold, "--goldSoft": T.goldSoft,
    "--red": T.red, "--green": T.green, "--input": T.input,
  };

  const [services, setServices] = usePersistentState("bp_services", () => []);
  const [staff, setStaff] = usePersistentState("bp_staff", () => []);
  const [customers, setCustomers] = usePersistentState("bp_customers", () => []);
  const [products, setProducts] = usePersistentState("bp_products", () => []);
  const [sales, setSales] = usePersistentState("bp_sales", () => []);
  const [expenses, setExpenses] = usePersistentState("bp_expenses", () => []);
  const [appointments, setAppointments] = usePersistentState("bp_appointments", () => []);
  const [attendance, setAttendance] = usePersistentState("bp_attendance", () => []);
  const [withdrawals, setWithdrawals] = usePersistentState("bp_withdrawals", () => []);
  const [payAdjustments, setPayAdjustments] = usePersistentState("bp_pay_adjustments", () => []);
  const [settlements, setSettlements] = usePersistentState("bp_settlements", () => []);
  const [ratings, setRatings] = usePersistentState("bp_ratings", () => []);
  const [announcements, setAnnouncements] = usePersistentState("bp_announcements", () => []);
  // إعدادات افتراضية آمنة فقط — بدون أي اسم محل أو بيانات حقيقية. المالك
  // بيدخل اسم الصالون واسمه بنفسه من شاشة "الإعدادات" أول مرة.
  const [settingsData, setSettingsData] = usePersistentState("bp_settings", () => ({
    salonName: "", ownerName: "", pointRate: 1, shopLat: null, shopLng: null, shopRadius: 100,
    periods: DEFAULT_PERIODS, noShowGraceMinutes: 15, maxActiveBookingsPerCustomer: 1,
    // --- التحكم في تطبيق حجز العملاء (فعلية، بتتفعّل في app2) ---
    bookingOpen: true, maxBookingsPerDay: null, allowEmployeeSelection: true,
    showQueueNumber: true, showPeopleAhead: true, showEstimatedTime: true,
    allowCustomerCancel: true, approachingTurnThreshold: 1,
  }));
  const [queue, setQueue] = usePersistentState("bp_queue", () => []);
  const [durationStats, setDurationStats] = usePersistentState("bp_duration_stats", () => ({}));
  const [team, setTeam] = usePersistentState("bp_team", () => ([
    { email: (user?.email || "").toLowerCase(), role: "owner", addedAt: Date.now() },
  ]));

  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const ready = services && staff && customers && products && sales && expenses && appointments && attendance && withdrawals && settingsData && team && ratings && announcements && payAdjustments && settlements && queue && durationStats;

  const myEmail = (user?.email || "").toLowerCase();
  const myMember = ready ? team.find((t) => t.email.toLowerCase() === myEmail) : null;
  const role = myMember?.role || null;
  const myStaffId = myMember?.staffId || null;

  const NAV = [
    { id: "dashboard", label: "لوحة التحكم", icon: LayoutDashboard, roles: ["owner", "manager", "cashier"] },
    { id: "mydash", label: "لوحتي", icon: UserCog, roles: ["barber"] },
    { id: "pos", label: "الكاشير POS", icon: ShoppingCart, roles: ["owner", "manager", "cashier"] },
    { id: "queue", label: "الطابور", icon: Calendar, roles: ["owner", "manager", "cashier"] },
    { id: "attendance", label: "الحضور والانصراف", icon: KeyRound, roles: ["owner", "manager", "cashier"] },
    { id: "customers", label: "العملاء", icon: Users, roles: ["owner", "manager", "cashier"] },
    { id: "services", label: "الخدمات", icon: Scissors, roles: ["owner", "manager"] },
    { id: "staff", label: "الحلاقون", icon: UserCog, roles: ["owner", "manager"] },
    { id: "withdrawals", label: "السلف والمسحوبات", icon: Banknote, roles: ["owner", "manager"] },
    { id: "inventory", label: "المخزون", icon: Package, roles: ["owner", "manager"] },
    { id: "expenses", label: "المصروفات", icon: Wallet, roles: ["owner", "manager"] },
    { id: "invoices", label: "الفواتير", icon: Receipt, roles: ["owner", "manager"] },
    { id: "reports", label: "التقارير", icon: FileBarChart, roles: ["owner", "manager"] },
    { id: "team", label: "الفريق والصلاحيات", icon: KeyRound, roles: ["owner"] },
    { id: "announcements", label: "الإعلانات", icon: Bell, roles: ["owner", "manager"] },
    { id: "settings", label: "الإعدادات", icon: SettingsIcon, roles: ["owner"] },
  ];
  const visibleNav = NAV.filter((n) => role && n.roles.includes(role));
  useEffect(() => { if (role && !visibleNav.find((n) => n.id === tab)) setTab(role === "barber" ? "mydash" : "dashboard"); }, [role]);

  if (!ready) {
    return (
      <div style={{ ...cssVars, background: "var(--bg)", color: "var(--text)" }} className="w-full h-full min-h-[600px] flex items-center justify-center" dir="rtl">
        <div className="display-font text-2xl animate-pulse" style={{ color: "var(--gold)" }}>...جارِ تجهيز BARBER PRO</div>
      </div>
    );
  }

  if (!role) {
    return (
      <div style={{ ...cssVars, background: "var(--bg)", color: "var(--text)" }} className="w-full h-full min-h-[600px] flex items-center justify-center p-4" dir="rtl">
        <div className="text-center rounded-2xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)", maxWidth: 360 }}>
          <div className="display-font text-2xl mb-2" style={{ color: "var(--gold)" }}>في انتظار الصلاحية</div>
          <div className="text-sm mb-4" style={{ color: "var(--muted)" }}>حسابك ({user?.email}) لسه معندوش صلاحية دخول. كلّم صاحب المحل عشان يضيفك من صفحة "الفريق والصلاحيات".</div>
          <button onClick={() => logout()} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: "var(--surface2)", color: "var(--muted)" }}>
            <LogOut size={14} /> تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...cssVars, background: "var(--bg)", color: "var(--text)" }} className="w-full min-h-[700px] flex" dir="rtl">
      <FontStyle />
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 p-4 gap-1" style={{ background: "var(--surface)", borderInlineStart: "1px solid var(--border)" }}>
        <div className="mb-2">
          <div className="display-font text-3xl" style={{ color: "var(--gold)" }}>BARBER <span style={{ color: "var(--text)" }}>PRO</span></div>
          <div className="stripe-divider mt-1 mb-3" />
          <div className="text-xs" style={{ color: "var(--muted)" }}>{settingsData.salonName}</div>
        </div>
        {visibleNav.map((n) => (
          <button key={n.id} onClick={() => setTab(n.id)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition"
            style={tab === n.id ? { background: "var(--gold)", color: "#141210" } : { color: "var(--text)" }}>
            <n.icon size={17} />{n.label}
          </button>
        ))}
        <div className="mt-auto pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>مسجل دخول بصفة</div>
          <div className="rounded-lg px-3 py-2 text-sm font-semibold mb-1" style={{ background: "var(--surface2)", color: "var(--gold)" }}>{ROLE_LABELS[role]}</div>
          <div className="text-xs mb-2 truncate" style={{ color: "var(--muted)" }}>{user?.email}</div>
          <button
            onClick={() => logout()}
            className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold"
            style={{ background: "var(--surface2)", color: "var(--muted)" }}
          >
            <LogOut size={14} /> تسجيل الخروج من الحساب
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 flex overflow-x-auto scrollbar-thin px-1 py-1.5 gap-1" style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        {visibleNav.map((n) => (
          <button key={n.id} onClick={() => setTab(n.id)} className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg shrink-0 text-[10px]"
            style={tab === n.id ? { background: "var(--gold)", color: "#141210" } : { color: "var(--muted)" }}>
            <n.icon size={16} />{n.label}
          </button>
        ))}
      </div>

      <main className="flex-1 min-w-0 p-4 md:p-6 pb-24 md:pb-6">
        <TopBar theme={theme} setTheme={setTheme} salonName={settingsData.salonName} role={role} />
        {tab === "dashboard" && <Dashboard {...{ sales, staff, services, customers, expenses, appointments, queue, withdrawals, role, announcements }} />}
        {tab === "mydash" && <MyDashboardTab {...{ staffMember: staff.find((s) => s.id === myStaffId), staff, sales, withdrawals, setWithdrawals, attendance, setAttendance, ratings, announcements, settingsData, setPayAdjustments, showToast }} />}
        {tab === "pos" && <POS {...{ services, staff, products, customers, setSales, sales, setProducts, setCustomers, settingsData, showToast, role }} />}
        {tab === "queue" && <QueueTab {...{ queue, setQueue, durationStats, setDurationStats, staff, services, settingsData, showToast }} />}
        {tab === "attendance" && <AttendanceTab {...{ staff, attendance, setAttendance, showToast, role, settingsData, withdrawals, setWithdrawals, payAdjustments, setPayAdjustments }} />}
        {tab === "customers" && <Customers {...{ customers, setCustomers, sales, staff, showToast }} />}
        {tab === "services" && <ServicesTab {...{ services, setServices, showToast }} />}
        {tab === "staff" && <StaffTab {...{ staff, setStaff, sales, role, showToast, withdrawals, setWithdrawals, ratings, setRatings, settlements, setSettlements }} />}
        {tab === "withdrawals" && <WithdrawalsTab {...{ staff, withdrawals, setWithdrawals, showToast }} />}
        {tab === "inventory" && <Inventory {...{ products, setProducts, showToast }} />}
        {tab === "expenses" && <Expenses {...{ expenses, setExpenses, showToast }} />}
        {tab === "invoices" && <InvoicesTab {...{ sales, setSales, staff, customers, role, showToast }} />}
        {tab === "reports" && <Reports {...{ sales, staff, services, products, customers, expenses, appointments, queue, withdrawals }} />}
        {tab === "team" && <TeamTab {...{ team, setTeam, myEmail, showToast, staff }} />}
        {tab === "announcements" && <AnnouncementsTab {...{ announcements, setAnnouncements, showToast }} />}
        {tab === "settings" && <SettingsTab {...{ settingsData, setSettingsData, showToast, setServices, setStaff, setCustomers, setProducts, setSales, setExpenses, setAppointments, setAttendance, setWithdrawals, setRatings, setAnnouncements }} />}
      </main>

      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 shadow-2xl"
          style={{ background: "var(--gold)", color: "#141210" }}>
          <Check size={16} />{toast}
        </div>
      )}
    </div>
  );
}

function TopBar({ theme, setTheme, salonName, role }) {
  const roleLabel = ROLE_LABELS[role];
  return (
    <div className="flex items-center justify-between mb-5">
      <div className="md:hidden display-font text-2xl" style={{ color: "var(--gold)" }}>BARBER PRO</div>
      <div className="hidden md:block text-sm" style={{ color: "var(--muted)" }}>مرحبًا بك، <span style={{ color: "var(--text)" }} className="font-semibold">{roleLabel}</span> — {salonName}</div>
      <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="p-2 rounded-lg" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        {theme === "dark" ? <Sun size={16} color="var(--gold)" /> : <Moon size={16} color="var(--gold)" />}
      </button>
    </div>
  );
}

/* ============================== DASHBOARD ============================== */
function Dashboard({ sales, staff, services, customers, expenses, appointments, queue, withdrawals, announcements }) {
  const [range, setRange] = useState("today");
  const now = new Date();

  const inRange = (dateStr) => {
    const d = new Date(dateStr);
    if (range === "today") return d.toDateString() === now.toDateString();
    if (range === "yesterday") { const y = new Date(now); y.setDate(now.getDate() - 1); return d.toDateString() === y.toDateString(); }
    if (range === "week") { const w = new Date(now); w.setDate(now.getDate() - 7); return d >= w; }
    if (range === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return true;
  };

  const rangeSales = sales.filter((s) => inRange(s.date));
  const rangeExpenses = expenses.filter((e) => inRange(e.date));
  const revenue = rangeSales.reduce((a, s) => a + s.total, 0);
  const commissions = rangeSales.reduce((a, s) => a + s.items.reduce((x, i) => x + (i.commission || 0), 0), 0);
  const expTotal = rangeExpenses.reduce((a, e) => a + e.amount, 0);
  const netProfit = revenue - commissions - expTotal;
  const avgTicket = rangeSales.length ? Math.round(revenue / rangeSales.length) : 0;
  const servicesDone = rangeSales.reduce((a, s) => a + s.items.filter((i) => i.type === "service").length, 0);
  const todaysAppts = (queue || []).filter((q) => q.date === todayISO() && q.status !== "cancelled").length;

  const serviceCount = {};
  rangeSales.forEach((s) => s.items.forEach((i) => { if (i.type === "service") serviceCount[i.name] = (serviceCount[i.name] || 0) + 1; }));
  const topServices = Object.entries(serviceCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const staffPerf = {};
  rangeSales.forEach((s) => {
    staffPerf[s.staffId] = staffPerf[s.staffId] || { revenue: 0, count: 0 };
    staffPerf[s.staffId].revenue += s.total; staffPerf[s.staffId].count += 1;
  });
  const topStaff = Object.entries(staffPerf).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5)
    .map(([id, v]) => ({ name: staff.find((s) => s.id === id)?.name || "—", ...v }));

  const last7 = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(now); d.setDate(now.getDate() - (6 - i));
    const dayTotal = sales.filter((s) => new Date(s.date).toDateString() === d.toDateString()).reduce((a, s) => a + s.total, 0);
    return { name: d.toLocaleDateString("ar-EG", { weekday: "short" }), value: dayTotal };
  });

  const recent = [...sales].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  const RANGE_LABELS = { today: "اليوم", yesterday: "أمس", week: "هذا الأسبوع", month: "هذا الشهر" };

  const allTimeRevenue = sales.reduce((a, s) => a + s.total, 0);
  const allTimeExpenses = expenses.reduce((a, e) => a + e.amount, 0);
  const allTimeWithdrawals = (withdrawals || []).reduce((a, w) => a + w.amount, 0);
  const drawerBalance = allTimeRevenue - (allTimeExpenses + allTimeWithdrawals);

  return (
    <div className="flex flex-col gap-5">
      <AnnouncementBanner announcements={announcements} />
      <div className="flex flex-wrap gap-2">
        {Object.entries(RANGE_LABELS).map(([k, l]) => (
          <button key={k} onClick={() => setRange(k)} className="px-3 py-1.5 rounded-full text-sm font-medium"
            style={range === k ? { background: "var(--gold)", color: "#141210" } : { background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)" }}>{l}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={DollarSign} label={`مبيعات ${RANGE_LABELS[range]}`} value={EGP(revenue)} accent />
        <StatCard icon={TrendingUp} label="صافي الربح" value={EGP(netProfit)} sub={netProfit >= 0 ? "ربح ✓" : "خسارة"} />
        <StatCard icon={Users} label="عدد العملاء" value={rangeSales.length} sub="فاتورة" />
        <StatCard icon={Calendar} label="حجوزات اليوم" value={todaysAppts} />
        <StatCard icon={Scissors} label="خدمات منفذة" value={servicesDone} />
        <StatCard icon={Wallet} label="عمولات الحلاقين" value={EGP(commissions)} />
        <StatCard icon={Receipt} label="متوسط الفاتورة" value={EGP(avgTicket)} />
        <StatCard icon={AlertTriangle} label="المصروفات" value={EGP(expTotal)} />
        <StatCard icon={Banknote} label="الموجود في الدرج" value={EGP(drawerBalance)} sub="إجمالي منذ البداية" accent />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <h3 className="font-bold mb-3">مبيعات آخر 7 أيام</h3>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={last7}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted)" fontSize={12} />
                <YAxis stroke="var(--muted)" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }} formatter={(v) => EGP(v)} />
                <Bar dataKey="value" fill="var(--gold)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <h3 className="font-bold mb-3">أكثر الخدمات مبيعًا</h3>
          {topServices.length === 0 ? <Empty text="لا توجد بيانات" /> : (
            <div className="flex flex-col gap-2">
              {topServices.map(([name, count], i) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><span style={{ color: "var(--gold)" }}>{i + 1}.</span>{name}</span>
                  <Badge tone="gold">{count}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <h3 className="font-bold mb-3">أفضل الحلاقين أداءً</h3>
          {topStaff.length === 0 ? <Empty text="لا توجد بيانات" /> : (
            <div className="flex flex-col gap-2">
              {topStaff.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: i < topStaff.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span className="flex items-center gap-2"><Star size={14} color="var(--gold)" />{s.name}</span>
                  <span style={{ color: "var(--muted)" }}>{s.count} فاتورة</span>
                  <span className="font-semibold">{EGP(s.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <h3 className="font-bold mb-3">آخر العمليات</h3>
          {recent.length === 0 ? <Empty text="لا توجد عمليات" /> : (
            <div className="flex flex-col gap-2">
              {recent.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                  <span>{s.number}</span>
                  <span style={{ color: "var(--muted)" }}>{fmtTime(s.date)}</span>
                  <span className="font-semibold">{EGP(s.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== POS ============================== */
function POS({ services, staff, products, customers, setSales, sales, setProducts, setCustomers, settingsData, showToast }) {
  const [customerId, setCustomerId] = useState("");
  const [staffId, setStaffId] = useState(staff[0]?.id || "");
  const [cart, setCart] = useState([]); // {type, refId, name, price, qty, commission}
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const [custSearch, setCustSearch] = useState("");
  const [svcSearch, setSvcSearch] = useState("");
  const [prodSearch, setProdSearch] = useState("");
  const [newCustModal, setNewCustModal] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [customDateMode, setCustomDateMode] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(() => { const d = new Date(); const pad = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; });

  const total = cart.reduce((a, i) => a + i.price * i.qty, 0);
  const finalTotal = Math.max(0, total - (Number(discount) || 0));
  const change = Math.max(0, (Number(paid) || 0) - finalTotal);

  const addService = (svc) => {
    const commission = svc.commissionType === "percent" ? Math.round(svc.price * svc.commissionValue / 100) : svc.commissionValue;
    setCart((c) => [...c, { type: "service", refId: svc.id, name: svc.name, price: svc.price, qty: 1, commission }]);
  };
  const addProduct = (p) => {
    setCart((c) => {
      const existing = c.find((i) => i.type === "product" && i.refId === p.id);
      if (existing) return c.map((i) => (i === existing ? { ...i, qty: i.qty + 1 } : i));
      return [...c, { type: "product", refId: p.id, name: p.name, price: p.sellPrice, qty: 1, commission: 0 }];
    });
  };
  const updateQty = (idx, qty) => setCart((c) => c.map((it, i) => (i === idx ? { ...it, qty: Math.max(1, qty) } : it)));
  const removeItem = (idx) => setCart((c) => c.filter((_, i) => i !== idx));

  const checkout = () => {
    if (cart.length === 0) return showToast("أضف خدمة أو منتج أولًا");
    if (!staffId) return showToast("اختر الحلاق");
    const discountRatio = total > 0 ? finalTotal / total : 1;
    const itemsWithAdjustedCommission = cart.map((i) => ({ ...i, commission: Math.round((i.commission || 0) * discountRatio) }));
    const saleDate = customDateMode && invoiceDate ? new Date(invoiceDate).toISOString() : new Date().toISOString();
    const sale = {
      id: uid(), number: "INV-" + (1000 + sales.length + 1), date: saleDate,
      customerId: customerId || null, staffId, items: itemsWithAdjustedCommission, discount: Number(discount) || 0,
      total: finalTotal, paid: Number(paid) || finalTotal, method, change,
    };
    setSales((s) => [...s, sale]);
    // update inventory
    setProducts((prods) => prods.map((p) => {
      const item = cart.find((i) => i.type === "product" && i.refId === p.id);
      return item ? { ...p, qty: Math.max(0, p.qty - item.qty) } : p;
    }));
    // update customer
    if (customerId) {
      const pointRate = settingsData?.pointRate > 0 ? settingsData.pointRate : 1;
      const earnedPoints = Math.round(finalTotal / pointRate);
      const newPoints = (customers.find((c) => c.id === customerId)?.points || 0) + earnedPoints;
      const newVisits = (customers.find((c) => c.id === customerId)?.visits || 0) + 1;
      setCustomers((cs) => cs.map((c) => c.id === customerId
        ? { ...c, visits: c.visits + 1, totalSpent: c.totalSpent + finalTotal, lastVisit: sale.date, points: c.points + earnedPoints }
        : c));
      const cust = customers.find((c) => c.id === customerId);
      if (cust?.phone) {
        setDoc(doc(db, "customerPoints", cust.phone), { name: cust.name, points: newPoints, visits: newVisits }).catch(() => {});
      }
    }
    setReceipt(sale);
    setCart([]); setDiscount(0); setPaid(""); setCustomerId(""); setCustomDateMode(false);
    showToast("تم إتمام البيع بنجاح");
  };

  const filteredCustomers = customers.filter((c) => c.name.includes(custSearch) || c.phone.includes(custSearch)).slice(0, 40);
  const filteredServices = services.filter((s) => s.active && s.name.includes(svcSearch));
  const filteredProducts = products.filter((p) => p.name.includes(prodSearch));
  const selectedCustomer = customers.find((c) => c.id === customerId);

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 flex flex-col gap-4">
        <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm" style={{ color: "var(--muted)" }}>العميل</span>
                <button onClick={() => setNewCustModal(true)} className="text-xs" style={{ color: "var(--gold)" }}>+ عميل جديد</button>
              </div>
              <div className="relative">
                <Search size={14} className="absolute top-3 right-3" style={{ color: "var(--muted)" }} />
                <TextInput style={{ paddingRight: 28 }} placeholder="ابحث بالاسم أو الهاتف (F2)" value={selectedCustomer ? selectedCustomer.name : custSearch}
                  onChange={(e) => { setCustSearch(e.target.value); setCustomerId(""); }} />
              </div>
              {custSearch && !customerId && (
                <div className="mt-1 rounded-lg overflow-hidden max-h-40 overflow-y-auto scrollbar-thin" style={{ border: "1px solid var(--border)" }}>
                  {filteredCustomers.map((c) => (
                    <div key={c.id} onClick={() => { setCustomerId(c.id); setCustSearch(""); }} className="px-3 py-2 text-sm cursor-pointer hover:opacity-80" style={{ background: "var(--surface2)" }}>
                      {c.name} <span style={{ color: "var(--muted)" }}>· {c.phone}</span>
                    </div>
                  ))}
                  {filteredCustomers.length === 0 && <div className="px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>لا نتائج</div>}
                </div>
              )}
            </div>
            <Field label="الحلاق">
              <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold">الخدمات (F3)</h3>
            <TextInput placeholder="بحث..." value={svcSearch} onChange={(e) => setSvcSearch(e.target.value)} style={{ width: 160 }} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-52 overflow-y-auto scrollbar-thin">
            {filteredServices.map((s) => (
              <button key={s.id} onClick={() => addService(s)} className="text-right p-2.5 rounded-xl text-sm" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
                <div className="font-semibold truncate">{s.name}</div>
                <div style={{ color: "var(--gold)" }} className="text-xs">{EGP(s.price)}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold">المنتجات (F4)</h3>
            <TextInput placeholder="بحث..." value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} style={{ width: 160 }} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-52 overflow-y-auto scrollbar-thin">
            {filteredProducts.map((p) => (
              <button key={p.id} disabled={p.qty <= 0} onClick={() => addProduct(p)} className="text-right p-2.5 rounded-xl text-sm disabled:opacity-30" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
                <div className="font-semibold truncate">{p.name}</div>
                <div className="flex justify-between text-xs"><span style={{ color: "var(--gold)" }}>{EGP(p.sellPrice)}</span><span style={{ color: "var(--muted)" }}>مخ:{p.qty}</span></div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cart / Checkout */}
      <div className="lg:col-span-2 flex flex-col gap-3">
        <div className="rounded-2xl p-4 flex-1" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <h3 className="font-bold mb-3">الفاتورة الحالية</h3>
          {cart.length === 0 ? <Empty text="لم تتم إضافة عناصر بعد" /> : (
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto scrollbar-thin mb-3">
              {cart.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex-1 truncate">{it.name}</div>
                  <input type="number" min={1} value={it.qty} onChange={(e) => updateQty(idx, Number(e.target.value))} className="w-12 text-center rounded px-1 py-0.5" style={inputStyle} />
                  <div className="w-16 text-left" style={{ color: "var(--gold)" }}>{EGP(it.price * it.qty)}</div>
                  <button onClick={() => removeItem(idx)}><Trash2 size={14} color="var(--red)" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between text-sm mb-1"><span style={{ color: "var(--muted)" }}>الإجمالي</span><span>{EGP(total)}</span></div>
          <Field label="الخصم (ج.م)"><TextInput type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>

          <div className="mb-3">
            <div className="text-sm mb-1" style={{ color: "var(--muted)" }}>تاريخ ووقت الفاتورة</div>
            <div className="flex gap-2 mb-2">
              <button onClick={() => setCustomDateMode(false)} className="flex-1 py-2 rounded-lg text-xs font-semibold" style={!customDateMode ? { background: "var(--gold)", color: "#141210" } : { background: "var(--surface2)", color: "var(--text)" }}>الآن (تلقائي)</button>
              <button onClick={() => setCustomDateMode(true)} className="flex-1 py-2 rounded-lg text-xs font-semibold" style={customDateMode ? { background: "var(--gold)", color: "#141210" } : { background: "var(--surface2)", color: "var(--text)" }}>تحديد تاريخ ووقت مختلف</button>
            </div>
            {customDateMode && <TextInput type="datetime-local" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />}
          </div>

          <div className="flex items-center justify-between text-lg font-bold mb-3"><span>الصافي</span><span style={{ color: "var(--gold)" }}>{EGP(finalTotal)}</span></div>

          <Field label="طريقة الدفع">
            <div className="grid grid-cols-3 gap-2">
              {[["cash", "كاش"], ["card", "فيزا"], ["wallet", "محفظة"]].map(([v, l]) => (
                <button key={v} onClick={() => setMethod(v)} className="py-2 rounded-lg text-sm font-semibold" style={method === v ? { background: "var(--gold)", color: "#141210" } : { background: "var(--surface2)", color: "var(--text)" }}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label="المبلغ المدفوع"><TextInput type="number" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={String(finalTotal)} /></Field>
          <div className="flex items-center justify-between text-sm mb-3"><span style={{ color: "var(--muted)" }}>الباقي</span><span className="font-semibold">{EGP(change)}</span></div>
          <Btn className="w-full py-3 text-base" onClick={checkout}>إتمام البيع (F8)</Btn>
        </div>
      </div>

      {newCustModal && (
        <Modal title="عميل جديد" onClose={() => setNewCustModal(false)}>
          <QuickCustomerForm onSave={(c) => { setCustomers((cs) => [...cs, c]); setCustomerId(c.id); setNewCustModal(false); }} />
        </Modal>
      )}

      {receipt && (
        <Modal title="تم البيع بنجاح ✓" onClose={() => setReceipt(null)}>
          <SaleReceipt sale={receipt} customers={customers} staff={staff} settingsData={settingsData} onClose={() => setReceipt(null)} />
        </Modal>
      )}
    </div>
  );
}

function QuickCustomerForm({ onSave }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  return (
    <div>
      <Field label="الاسم"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="رقم الهاتف"><TextInput value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Btn className="w-full" disabled={!name} onClick={() => onSave({ id: uid(), name, phone, notes: "", favoriteBarberId: "", visits: 0, totalSpent: 0, lastVisit: null, birthday: "", points: 0 })}>حفظ العميل</Btn>
    </div>
  );
}

function SaleReceipt({ sale, customers, staff, settingsData, onClose }) {
  const cust = customers.find((c) => c.id === sale.customerId);
  const stf = staff.find((s) => s.id === sale.staffId);
  return (
    <div>
      <div id="receipt-print" className="p-4 rounded-xl mb-4" style={{ background: "var(--surface2)", fontFamily: "monospace" }}>
        <div className="text-center mb-2">
          <div className="display-font text-xl" style={{ color: "var(--gold)" }}>{settingsData.salonName}</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>فاتورة {sale.number} · {fmtDate(sale.date)} {fmtTime(sale.date)}</div>
        </div>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>العميل: {cust?.name || "زائر"} · الحلاق: {stf?.name}</div>
        <div style={{ borderTop: "1px dashed var(--border)" }} className="my-2" />
        <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--muted)" }}>
          <span>الخدمة / المنتج</span><span>سعر الوحدة × الكمية = المجموع</span>
        </div>
        {sale.items.map((it, i) => (
          <div key={i} className="flex justify-between text-sm mb-0.5">
            <span>{it.name}{it.type === "product" ? " (منتج)" : ""}</span>
            <span>{EGP(it.price)} × {it.qty} = {EGP(it.price * it.qty)}</span>
          </div>
        ))}
        <div style={{ borderTop: "1px dashed var(--border)" }} className="my-2" />
        <div className="flex justify-between text-sm"><span>إجمالي الخدمات والمنتجات</span><span>{EGP(sale.items.reduce((a, i) => a + i.price * i.qty, 0))}</span></div>
        <div className="flex justify-between text-sm"><span>الخصم</span><span>{sale.discount > 0 ? `- ${EGP(sale.discount)}` : ""}</span></div>
        <div style={{ borderTop: "1px dashed var(--border)" }} className="my-2" />
        <div className="flex justify-between font-bold text-base"><span>الإجمالي المستحق دفعه</span><span>{EGP(sale.total)}</span></div>
        <div className="flex justify-between text-xs mt-1" style={{ color: "var(--muted)" }}><span>طريقة الدفع</span><span>{sale.method === "cash" ? "كاش" : sale.method === "card" ? "فيزا / بطاقة" : "محفظة إلكترونية"}</span></div>
        <div className="flex justify-between text-xs" style={{ color: "var(--muted)" }}><span>المبلغ المدفوع</span><span>{EGP(sale.paid)}</span></div>
        <div className="flex justify-between text-xs" style={{ color: "var(--muted)" }}><span>الباقي للعميل</span><span>{EGP(sale.change)}</span></div>
        <div className="text-center text-[10px] mt-3" style={{ color: "var(--muted)" }}>شكرًا لزيارتكم ✂️</div>
      </div>
      <div className="flex gap-2">
        <Btn className="flex-1" onClick={() => window.print()}><Printer size={15} /> طباعة</Btn>
        <Btn variant="ghost" className="flex-1" onClick={onClose}>إغلاق</Btn>
      </div>
    </div>
  );
}

/* ============================== SERVICES ============================== */
function ServicesTab({ services, setServices, showToast }) {
  const [modal, setModal] = useState(null); // {edit: service|null}
  const save = (data) => {
    if (data.id) setServices((s) => s.map((x) => (x.id === data.id ? data : x)));
    else setServices((s) => [...s, { ...data, id: uid() }]);
    setModal(null); showToast("تم الحفظ");
  };
  const del = (id) => { setServices((s) => s.filter((x) => x.id !== id)); showToast("تم الحذف"); };
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>الخدمات</h2>
        <Btn onClick={() => setModal({ edit: null })}><Plus size={16} /> خدمة جديدة</Btn>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--surface2)" }}>
            <tr>{["الاسم", "السعر", "المدة", "العمولة", "الحالة", ""].map((h) => <th key={h} className="p-3 text-right font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3">{EGP(s.price)}</td>
                <td className="p-3">{s.duration} د</td>
                <td className="p-3">{s.commissionType === "percent" ? `${s.commissionValue}%` : EGP(s.commissionValue)}</td>
                <td className="p-3"><Badge tone={s.active ? "green" : "red"}>{s.active ? "فعّالة" : "متوقفة"}</Badge></td>
                <td className="p-3 flex gap-2">
                  <button onClick={() => setModal({ edit: s })}><Pencil size={15} color="var(--gold)" /></button>
                  <button onClick={() => del(s.id)}><Trash2 size={15} color="var(--red)" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal title={modal.edit ? "تعديل خدمة" : "خدمة جديدة"} onClose={() => setModal(null)}>
          <ServiceForm initial={modal.edit} onSave={save} />
        </Modal>
      )}
    </div>
  );
}
function ServiceForm({ initial, onSave }) {
  const [f, setF] = useState(initial || { name: "", price: 100, duration: 30, commissionType: "percent", commissionValue: 30, desc: "", active: true });
  return (
    <div>
      <Field label="اسم الخدمة"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="السعر (ج.م)"><TextInput type="number" value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} /></Field>
        <Field label="المدة (دقيقة)"><TextInput type="number" value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="نوع العمولة">
          <Select value={f.commissionType} onChange={(e) => setF({ ...f, commissionType: e.target.value })}>
            <option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت</option>
          </Select>
        </Field>
        <Field label="قيمة العمولة"><TextInput type="number" value={f.commissionValue} onChange={(e) => setF({ ...f, commissionValue: Number(e.target.value) })} /></Field>
      </div>
      <Field label="وصف"><TextInput value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></Field>
      <label className="flex items-center gap-2 mb-4 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> فعّالة</label>
      <Btn className="w-full" disabled={!f.name} onClick={() => onSave(f)}>حفظ</Btn>
    </div>
  );
}

/* ============================== STAFF ============================== */
function StaffTab({ staff, setStaff, sales, role, showToast, withdrawals, setWithdrawals, ratings, setRatings, settlements, setSettlements }) {
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const save = (data) => {
    const dup = staff.some((x) => x.code && data.code && x.code === data.code && x.id !== data.id);
    if (dup) return showToast("هذا الكود مستخدم بالفعل لموظف آخر");
    if (data.id) setStaff((s) => s.map((x) => (x.id === data.id ? data : x)));
    else setStaff((s) => [...s, { ...data, id: uid() }]);
    setModal(null); showToast("تم الحفظ");
  };
  const del = (id) => { setStaff((s) => s.filter((x) => x.id !== id)); showToast("تم الحذف"); };

  if (detail) return <StaffDetail staffMember={detail} setStaff={setStaff} sales={sales} withdrawals={withdrawals} setWithdrawals={setWithdrawals} ratings={ratings} setRatings={setRatings} settlements={settlements} setSettlements={setSettlements} showToast={showToast} onBack={() => setDetail(null)} />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>الحلاقون والموظفون</h2>
        {role !== "barber" && <Btn onClick={() => setModal({ edit: null })}><Plus size={16} /> موظف جديد</Btn>}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {staff.map((s) => {
          const staffSales = sales.filter((sl) => sl.staffId === s.id);
          const revenue = staffSales.reduce((a, sl) => a + sl.total, 0);
          return (
            <div key={s.id} className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center display-font text-lg" style={{ background: "var(--surface2)", color: "var(--gold)" }}>{s.name[0]}</div>
                  <div><div className="font-bold">{s.name}</div><div className="text-xs" style={{ color: "var(--muted)" }}>{s.phone}</div></div>
                </div>
                <Badge tone={s.active ? "green" : "red"}>{s.active ? "نشط" : "موقوف"}</Badge>
              </div>
              <div className="flex justify-between text-sm mb-1"><span style={{ color: "var(--muted)" }}>كود الحضور</span><span className="font-semibold tracking-widest" style={{ color: "var(--gold)" }}>{s.code || "—"}</span></div>
              <div className="flex justify-between text-sm mb-3"><span style={{ color: "var(--muted)" }}>مبيعات</span><span className="font-semibold">{EGP(revenue)}</span></div>
              <div className="flex gap-2">
                <Btn variant="secondary" className="flex-1" onClick={() => setDetail(s)}>التفاصيل <ChevronRight size={14} /></Btn>
                {role !== "barber" && <button onClick={() => setModal({ edit: s })}><Pencil size={15} color="var(--gold)" /></button>}
                {role !== "barber" && <button onClick={() => del(s.id)}><Trash2 size={15} color="var(--red)" /></button>}
              </div>
            </div>
          );
        })}
      </div>
      {modal && (
        <Modal title={modal.edit ? "تعديل موظف" : "موظف جديد"} onClose={() => setModal(null)}>
          <StaffForm initial={modal.edit} onSave={save} />
        </Modal>
      )}
    </div>
  );
}
function StaffForm({ initial, onSave }) {
  const [f, setF] = useState(initial || { name: "", phone: "", role: "barber", active: true, hireDate: todayISO(), commissionType: "percent", commissionValue: 30, advance: 0, code: "", loginPin: "", shiftStart: 10, shiftEnd: 22, workDays: ["SAT", "SUN", "MON", "TUE", "WED", "THU"], monthlyTarget: 0, payType: "commission", dailyWage: 0, standardHours: 12 });
  const DAY_LABELS = { SUN: "أحد", MON: "اتنين", TUE: "تلات", WED: "أربع", THU: "خميس", FRI: "جمعة", SAT: "سبت" };
  const toggleDay = (d) => setF((prev) => ({ ...prev, workDays: prev.workDays.includes(d) ? prev.workDays.filter((x) => x !== d) : [...prev.workDays, d] }));
  return (
    <div>
      <Field label="الاسم"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="رقم الهاتف"><TextInput value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="كود الحضور والانصراف (اختره بنفسك)">
          <TextInput value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} maxLength={6} placeholder="اكتب أي كود تختاره، مثال: 5521" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="كلمة سر دخول الحساب (6 أرقام — سرّية، منفصلة عن كود الحضور)">
          <TextInput value={f.loginPin || ""} onChange={(e) => setF({ ...f, loginPin: e.target.value.replace(/\D/g, "") })} maxLength={6} placeholder="اكتب 6 أرقام، مثال: 738214" style={{ letterSpacing: "0.2em" }} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الوظيفة">
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="barber">حلاق</option><option value="assistant">مساعد</option><option value="manager">مدير</option>
          </Select>
        </Field>
        <Field label="تاريخ التعيين"><TextInput type="date" value={f.hireDate} onChange={(e) => setF({ ...f, hireDate: e.target.value })} /></Field>
      </div>

      <div className="rounded-xl p-3 mb-3" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
        <div className="text-sm font-semibold mb-2" style={{ color: "var(--gold)" }}>طريقة احتساب الأجر</div>
        <Field label="نظام الأجر">
          <Select value={f.payType || "commission"} onChange={(e) => setF({ ...f, payType: e.target.value })}>
            <option value="commission">عمولة على الخدمات</option>
            <option value="daily">راتب يومي ثابت</option>
          </Select>
        </Field>
        {f.payType === "daily" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="الراتب اليومي الثابت (ج.م)"><TextInput type="number" value={f.dailyWage || 0} onChange={(e) => setF({ ...f, dailyWage: Number(e.target.value) })} /></Field>
            <Field label="ساعات الشفت المعياري"><TextInput type="number" value={f.standardHours || 12} onChange={(e) => setF({ ...f, standardHours: Number(e.target.value) })} /></Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="نوع العمولة الافتراضي">
              <Select value={f.commissionType} onChange={(e) => setF({ ...f, commissionType: e.target.value })}>
                <option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت</option>
              </Select>
            </Field>
            <Field label="قيمة العمولة"><TextInput type="number" value={f.commissionValue} onChange={(e) => setF({ ...f, commissionValue: Number(e.target.value) })} /></Field>
          </div>
        )}
        {f.payType === "daily" && (
          <div className="text-xs leading-6" style={{ color: "var(--muted)" }}>
            أول ما يسجل حضور، هيتضاف راتب اليوم كامل تلقائيًا. لما يسجل انصراف، لو شغل أقل أو أكتر من {f.standardHours || 12} ساعة، هيتبعت تنبيه للمدير يوافق عليه قبل ما يتخصم أو يتضاف فرق الساعات.
          </div>
        )}
      </div>
      <Field label="السلف الحالية (ج.م)"><TextInput type="number" value={f.advance} onChange={(e) => setF({ ...f, advance: Number(e.target.value) })} /></Field>
      <Field label="تارجت المبيعات الشهري (ج.م) — 0 يعني بدون تارجت"><TextInput type="number" value={f.monthlyTarget || 0} onChange={(e) => setF({ ...f, monthlyTarget: Number(e.target.value) })} /></Field>

      <div className="rounded-xl p-3 mb-3" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
        <div className="text-sm font-semibold mb-2" style={{ color: "var(--gold)" }}>وردية العمل (تُستخدم في صفحة حجز العملاء)</div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="من الساعة"><TextInput type="number" min="0" max="23" value={f.shiftStart ?? 10} onChange={(e) => setF({ ...f, shiftStart: Number(e.target.value) })} /></Field>
          <Field label="إلى الساعة"><TextInput type="number" min="0" max="23" value={f.shiftEnd ?? 22} onChange={(e) => setF({ ...f, shiftEnd: Number(e.target.value) })} /></Field>
        </div>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>أيام العمل</div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(DAY_LABELS).map((d) => (
            <button key={d} type="button" onClick={() => toggleDay(d)} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: (f.workDays || []).includes(d) ? "var(--gold)" : "var(--surface)", color: (f.workDays || []).includes(d) ? "#1A1400" : "var(--muted)", border: "1px solid var(--border)" }}>
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 mb-4 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> نشط</label>
      <Btn className="w-full" disabled={!f.name || !f.code} onClick={() => onSave(f)}>حفظ</Btn>
    </div>
  );
}
function StaffDetail({ staffMember: s, setStaff, sales, withdrawals, setWithdrawals, showToast, onBack, ratings, setRatings, settlements, setSettlements }) {
  const [wModal, setWModal] = useState(false);
  const [rModal, setRModal] = useState(false);
  const [settleModal, setSettleModal] = useState(false);
  const mySales = sales.filter((sl) => sl.staffId === s.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const revenue = mySales.reduce((a, sl) => a + sl.total, 0);
  const commission = mySales.reduce((a, sl) => a + sl.items.reduce((x, i) => x + (i.commission || 0), 0), 0);

  // العمولات والسلف/المكافآت بعد آخر تسوية بس، عشان الصافي المستحق يبدأ من صفر بعد كل تسوية
  const commissionSinceSettle = mySales.filter((sl) => afterSettlement(sl.date, s)).reduce((a, sl) => a + sl.items.reduce((x, i) => x + (i.commission || 0), 0), 0);

  const now = new Date();
  const myWithdrawals = (withdrawals || []).filter((w) => w.staffId === s.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const withdrawalsSinceSettle = myWithdrawals.filter((w) => afterSettlement(w.date, s));
  const monthWithdrawals = myWithdrawals.filter((w) => { const d = new Date(w.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const monthAdjust = monthWithdrawals.reduce((a, w) => a + wSign(w) * w.amount, 0);
  const allAdjust = myWithdrawals.reduce((a, w) => a + wSign(w) * w.amount, 0);
  const adjustSinceSettle = withdrawalsSinceSettle.reduce((a, w) => a + wSign(w) * w.amount, 0);
  const net = commission - (s.advance || 0) + allAdjust;
  const netSinceSettle = commissionSinceSettle - (s.advance || 0) + adjustSinceSettle;

  const myRatings = (ratings || []).filter((r) => r.staffId === s.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const avgRating = myRatings.length ? (myRatings.reduce((a, r) => a + r.stars, 0) / myRatings.length) : 0;

  const mySettlements = (settlements || []).filter((st) => st.staffId === s.id).sort((a, b) => new Date(b.date) - new Date(a.date));

  const addWithdrawal = (data) => {
    setWithdrawals((w) => [...w, { ...data, id: uid(), staffId: s.id }]);
    setWModal(false); showToast("تم تسجيل العملية");
  };
  const delWithdrawal = (id) => setWithdrawals((w) => w.filter((x) => x.id !== id));
  const addRating = (data) => {
    setRatings((r) => [...r, { ...data, id: uid(), staffId: s.id }]);
    setRModal(false); showToast("تم تسجيل التقييم");
  };
  const delRating = (id) => setRatings((r) => r.filter((x) => x.id !== id));

  const settleAccount = (note) => {
    setSettlements((list) => [...list, { id: uid(), staffId: s.id, amount: netSinceSettle, date: new Date().toISOString(), note }]);
    setStaff((list) => list.map((x) => (x.id === s.id ? { ...x, lastSettledAt: new Date().toISOString(), advance: 0 } : x)));
    setSettleModal(false);
    showToast(`تمت تسوية حساب ${s.name} — بدأ حساب جديد من صفر`);
  };

  return (
    <div>
      <button onClick={onBack} className="text-sm mb-4 flex items-center gap-1" style={{ color: "var(--gold)" }}><ChevronRight size={14} /> رجوع للموظفين</button>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full flex items-center justify-center display-font text-2xl" style={{ background: "var(--surface2)", color: "var(--gold)" }}>{s.name[0]}</div>
          <div>
            <div className="display-font text-2xl">{s.name}</div>
            <div className="text-sm" style={{ color: "var(--muted)" }}>{s.phone} · {s.role === "assistant" ? "مساعد" : s.role === "manager" ? "مدير" : "حلاق"} · كود: <span style={{ color: "var(--gold)" }}>{s.code || "—"}</span></div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn variant="secondary" onClick={() => setRModal(true)}><Star size={15} /> تقييم جديد</Btn>
          <Btn variant="secondary" onClick={() => setWModal(true)}><Banknote size={15} /> عملية مالية جديد</Btn>
          <Btn onClick={() => setSettleModal(true)} disabled={netSinceSettle === 0}><Check size={15} /> تسوية حساب</Btn>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard icon={DollarSign} label="إجمالي المبيعات" value={EGP(revenue)} />
        <StatCard icon={Receipt} label="عدد العملاء" value={mySales.length} />
        <StatCard icon={Wallet} label="إجمالي العمولات" value={EGP(commission)} accent />
        <StatCard icon={Star} label="متوسط التقييم" value={avgRating ? avgRating.toFixed(1) : "—"} />
      </div>
      <div className="rounded-2xl p-4 mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        {s.lastSettledAt && <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>آخر تسوية: {fmtDate(s.lastSettledAt)} — الحساب اللي تحت ده من بعدها بس</div>}
        <div className="flex justify-between text-sm mb-1"><span style={{ color: "var(--muted)" }}>عمولات{s.lastSettledAt ? " (بعد آخر تسوية)" : " (كل الفترات)"}</span><span>{EGP(commissionSinceSettle)}</span></div>
        {!s.lastSettledAt && <div className="flex justify-between text-sm mb-1"><span style={{ color: "var(--muted)" }}>سلفة سابقة</span><span>- {EGP(s.advance || 0)}</span></div>}
        <div className="flex justify-between text-sm mb-2"><span style={{ color: "var(--muted)" }}>سلف / مكافآت / خصومات{s.lastSettledAt ? " (بعد آخر تسوية)" : ""}</span><span>{adjustSinceSettle >= 0 ? "+ " : "- "}{EGP(Math.abs(adjustSinceSettle))}</span></div>
        <div className="flex justify-between font-bold text-lg pt-2" style={{ borderTop: "1px solid var(--border)" }}><span>صافي المستحق حاليًا</span><span style={{ color: "var(--gold)" }}>{EGP(netSinceSettle)}</span></div>
      </div>

      {mySettlements.length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-5" style={{ border: "1px solid var(--border)" }}>
          <div className="p-3 font-bold" style={{ background: "var(--surface2)" }}>سجل التسويات (المدفوعات السابقة)</div>
          {mySettlements.map((st) => (
            <div key={st.id} className="flex justify-between items-center text-sm p-3" style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
              <span>{fmtDate(st.date)} {fmtTime(st.date)}</span>
              <span style={{ color: "var(--muted)" }}>{st.note || "—"}</span>
              <span className="font-semibold" style={{ color: "var(--green)" }}>تم دفع {EGP(st.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl overflow-hidden mb-5" style={{ border: "1px solid var(--border)" }}>
        <div className="p-3 font-bold flex justify-between" style={{ background: "var(--surface2)" }}><span>سجل السلف والمكافآت والخصومات</span></div>
        {myWithdrawals.length === 0 ? <Empty text="لا توجد عمليات صرف" /> : myWithdrawals.slice(0, 30).map((w) => (
          <div key={w.id} className="flex justify-between items-center text-sm p-3" style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
            <span>{fmtDate(w.date)}</span>
            <Badge tone={w.type === "bonus" ? "green" : w.type === "deduction" ? "red" : "gold"}>{TYPE_LABEL[w.type] || "سلفة"}</Badge>
            <span style={{ color: "var(--muted)" }}>{w.note || "—"}</span>
            <span className="font-semibold">{wSign(w) > 0 ? "+ " : "- "}{EGP(w.amount)}</span>
            <button onClick={() => delWithdrawal(w.id)}><Trash2 size={14} color="var(--red)" /></button>
          </div>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden mb-5" style={{ border: "1px solid var(--border)" }}>
        <div className="p-3 font-bold" style={{ background: "var(--surface2)" }}>سجل التقييمات</div>
        {myRatings.length === 0 ? <Empty text="لا توجد تقييمات بعد" /> : myRatings.map((r) => (
          <div key={r.id} className="flex justify-between items-center text-sm p-3" style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
            <span>{fmtDate(r.date)}</span>
            <span style={{ color: "var(--gold)" }}>{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</span>
            <span style={{ color: "var(--muted)" }}>{r.note || "—"}</span>
            <button onClick={() => delRating(r.id)}><Trash2 size={14} color="var(--red)" /></button>
          </div>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="p-3 font-bold" style={{ background: "var(--surface2)" }}>سجل العمليات</div>
        {mySales.length === 0 ? <Empty text="لا توجد عمليات" /> : mySales.slice(0, 30).map((sl) => (
          <div key={sl.id} className="flex justify-between text-sm p-3" style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
            <span>{sl.number}</span><span style={{ color: "var(--muted)" }}>{fmtDate(sl.date)}</span><span className="font-semibold">{EGP(sl.total)}</span>
          </div>
        ))}
      </div>

      {wModal && (
        <Modal title={`عملية مالية - ${s.name}`} onClose={() => setWModal(false)}>
          <WithdrawalForm onSave={addWithdrawal} />
        </Modal>
      )}
      {rModal && (
        <Modal title={`تقييم جديد - ${s.name}`} onClose={() => setRModal(false)}>
          <RatingForm onSave={addRating} />
        </Modal>
      )}
      {settleModal && (
        <Modal title={`تسوية حساب - ${s.name}`} onClose={() => setSettleModal(false)}>
          <SettleAccountForm amount={netSinceSettle} onConfirm={settleAccount} />
        </Modal>
      )}
    </div>
  );
}

function SettleAccountForm({ amount, onConfirm }) {
  const [note, setNote] = useState("دفع كاش");
  return (
    <div>
      <div className="rounded-xl p-4 mb-4 text-center" style={{ background: "var(--surface2)" }}>
        <div className="text-sm mb-1" style={{ color: "var(--muted)" }}>المبلغ اللي هيتدفع دلوقتي</div>
        <div className="display-font text-4xl" style={{ color: "var(--gold)" }}>{EGP(amount)}</div>
      </div>
      <Field label="طريقة الدفع / ملاحظة"><TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="دفع كاش، تحويل بنكي..." /></Field>
      <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>بعد التأكيد، حساب الموظف هيبدأ من صفر، وده هيتسجل في سجل التسويات بتاريخه ومبلغه عشان يفضل موثّق دايمًا.</div>
      <Btn className="w-full" onClick={() => onConfirm(note)}>تأكيد الدفع وبدء حساب جديد</Btn>
    </div>
  );
}

function RatingForm({ onSave }) {
  const [f, setF] = useState({ stars: 5, note: "", date: todayISO() });
  return (
    <div>
      <Field label="التقييم">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setF({ ...f, stars: n })} type="button">
              <Star size={26} fill={n <= f.stars ? "var(--gold)" : "none"} color="var(--gold)" />
            </button>
          ))}
        </div>
      </Field>
      <Field label="التاريخ"><TextInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="ملاحظات (اختياري)"><TextInput value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="سبب التقييم..." /></Field>
      <Btn className="w-full" onClick={() => onSave(f)}>حفظ التقييم</Btn>
    </div>
  );
}

function WithdrawalForm({ onSave, staffOptions, staffId, setStaffId }) {
  const [f, setF] = useState({ amount: 0, date: todayISO(), note: "", type: "advance" });
  return (
    <div>
      {staffOptions && (
        <Field label="الموظف">
          <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="نوع العملية">
        <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="advance">سلفة (بتتخصم)</option>
          <option value="bonus">مكافأة (بتتضاف)</option>
          <option value="deduction">خصم (بيتخصم)</option>
        </Select>
      </Field>
      <Field label="المبلغ (ج.م)"><TextInput type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></Field>
      <Field label="التاريخ"><TextInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="السبب / ملاحظات"><TextInput value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="سبب الصرف أو المكافأة أو الخصم..." /></Field>
      <Btn className="w-full" disabled={!f.amount} onClick={() => onSave(f)}>تسجيل العملية</Btn>
    </div>
  );
}

const wSign = (w) => (w.type === "bonus" ? 1 : -1); // legacy entries with no type behave like "advance" (subtract)
const TYPE_LABEL = { advance: "سلفة", bonus: "مكافأة", deduction: "خصم" };
const afterSettlement = (dateStr, s) => !s.lastSettledAt || new Date(dateStr) > new Date(s.lastSettledAt);

/* ============================== WITHDRAWALS (ALL STAFF) ============================== */
function WithdrawalsTab({ staff, withdrawals, setWithdrawals, showToast }) {
  const [modal, setModal] = useState(false);
  const [staffId, setStaffId] = useState(staff[0]?.id || "");
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const monthList = withdrawals.filter((w) => { const d = new Date(w.date); return d.getMonth() === Number(month) && d.getFullYear() === Number(year); });
  const totalsByStaff = staff.map((s) => ({
    staff: s,
    total: monthList.filter((w) => w.staffId === s.id).reduce((a, w) => a + wSign(w) * w.amount, 0),
    count: monthList.filter((w) => w.staffId === s.id).length,
  }));
  const grandTotal = monthList.reduce((a, w) => a + wSign(w) * w.amount, 0);

  const save = (data) => { setWithdrawals((w) => [...w, { ...data, id: uid(), staffId }]); setModal(false); showToast("تم تسجيل عملية الصرف"); };
  const del = (id) => setWithdrawals((w) => w.filter((x) => x.id !== id));

  const monthNames = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

  return (
    <div>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>السلف والمسحوبات النقدية</h2>
        <div className="flex gap-2 items-center">
          <Select value={month} onChange={(e) => setMonth(e.target.value)}>{monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}</Select>
          <TextInput type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 90 }} />
          <Btn onClick={() => setModal(true)}><Plus size={16} /> صرف جديد</Btn>
        </div>
      </div>

      <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="text-sm" style={{ color: "var(--muted)" }}>إجمالي المسحوبات في {monthNames[month]} {year}</div>
        <div className="display-font text-3xl" style={{ color: "var(--gold)" }}>{EGP(grandTotal)}</div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        {totalsByStaff.map(({ staff: s, total, count }) => (
          <div key={s.id} className="rounded-xl p-3 flex items-center justify-between" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div><div className="font-semibold">{s.name}</div><div className="text-xs" style={{ color: "var(--muted)" }}>{count} عملية صرف</div></div>
            <div className="font-bold" style={{ color: "var(--gold)" }}>{EGP(total)}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--surface2)" }}><tr>{["الموظف", "النوع", "المبلغ", "التاريخ", "ملاحظات", ""].map((h) => <th key={h} className="p-3 text-right font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {[...monthList].sort((a, b) => new Date(b.date) - new Date(a.date)).map((w) => (
              <tr key={w.id} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                <td className="p-3 font-medium">{staff.find((s) => s.id === w.staffId)?.name || "—"}</td>
                <td className="p-3"><Badge tone={w.type === "bonus" ? "green" : w.type === "deduction" ? "red" : "gold"}>{TYPE_LABEL[w.type] || "سلفة"}</Badge></td>
                <td className="p-3">{wSign(w) > 0 ? "+ " : "- "}{EGP(w.amount)}</td>
                <td className="p-3">{fmtDate(w.date)}</td>
                <td className="p-3" style={{ color: "var(--muted)" }}>{w.note || "—"}</td>
                <td className="p-3"><button onClick={() => del(w.id)}><Trash2 size={15} color="var(--red)" /></button></td>
              </tr>
            ))}
            {monthList.length === 0 && <tr><td colSpan={6}><Empty text="لا توجد عمليات صرف في هذا الشهر" /></td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title="صرف نقدية جديد" onClose={() => setModal(false)}>
          <WithdrawalForm onSave={save} staffOptions={staff} staffId={staffId} setStaffId={setStaffId} />
        </Modal>
      )}
    </div>
  );
}

/* ============================== ATTENDANCE ============================== */
function AttendanceTab({ staff, attendance, setAttendance, showToast, role, settingsData, withdrawals, setWithdrawals, payAdjustments, setPayAdjustments }) {
  const [code, setCode] = useState("");
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [manualModal, setManualModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [checking, setChecking] = useState(false);
  const canManage = role === "owner" || role === "manager";

  const findOpenSession = (staffId) => attendance.find((a) => a.staffId === staffId && !a.checkOut);

  const clockIn = async () => {
    const s = staff.find((x) => x.code === code.trim());
    if (!s) return showToast("كود غير صحيح");
    if (findOpenSession(s.id)) return showToast(`${s.name} مسجل حضور بالفعل ولم ينصرف بعد`);
    setChecking(true);
    try { await verifyShopLocation(settingsData); } catch (err) { setChecking(false); return showToast(err); }
    setChecking(false);
    setAttendance((a) => [...a, { id: uid(), staffId: s.id, date: todayISO(), checkIn: new Date().toISOString(), checkOut: null }]);
    if (s.payType === "daily" && s.dailyWage > 0) {
      setWithdrawals((w) => [...w, { id: uid(), staffId: s.id, type: "bonus", amount: s.dailyWage, date: todayISO(), note: `راتب يوم ${fmtDate(todayISO())} (تلقائي عند الحضور)` }]);
    }
    showToast(`تم تسجيل حضور: ${s.name}`);
    setCode("");
  };
  const clockOut = async () => {
    const s = staff.find((x) => x.code === code.trim());
    if (!s) return showToast("كود غير صحيح");
    const open = findOpenSession(s.id);
    if (!open) return showToast(`${s.name} لم يسجل حضور بعد`);
    setChecking(true);
    try { await verifyShopLocation(settingsData); } catch (err) { setChecking(false); return showToast(err); }
    setChecking(false);
    const checkOutISO = new Date().toISOString();
    setAttendance((a) => a.map((x) => (x.id === open.id ? { ...x, checkOut: checkOutISO } : x)));
    const adj = computeDailyWageAdjustment(s, open.checkIn, checkOutISO);
    if (adj) {
      setPayAdjustments((list) => [...list, { id: uid(), staffId: s.id, date: todayISO(), status: "pending", createdAt: Date.now(), ...adj }]);
      showToast(`تم تسجيل انصراف: ${s.name} — في انتظار موافقة المدير على ${adj.type === "deduction" ? "خصم" : "مكافأة"} ${Math.abs(adj.diffHours)} ساعة`);
    } else {
      showToast(`تم تسجيل انصراف: ${s.name}`);
    }
    setCode("");
  };

  const saveManual = (data) => {
    if (editId) {
      setAttendance((a) => a.map((x) => (x.id === editId ? { ...x, ...data } : x)));
      showToast("تم تعديل السجل");
    } else {
      setAttendance((a) => [...a, { id: uid(), ...data }]);
      showToast("تم إضافة سجل الحضور");
    }
    setManualModal(false); setEditId(null);
  };

  const dayList = attendance.filter((a) => a.date === dateFilter).sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn));
  const del = (id) => setAttendance((a) => a.filter((x) => x.id !== id));

  const duration = (a) => {
    if (!a.checkOut) return "—";
    const mins = Math.round((new Date(a.checkOut) - new Date(a.checkIn)) / 60000);
    return `${Math.floor(mins / 60)}س ${mins % 60}د`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>الحضور والانصراف</h2>
        {canManage && <Btn onClick={() => { setEditId(null); setManualModal(true); }}><Plus size={16} /> تسجيل يدوي بوقت محدد</Btn>}
      </div>

      {canManage && payAdjustments.filter((p) => p.status === "pending").length > 0 && (
        <div className="rounded-2xl p-4 mb-5" style={{ background: "rgba(198,161,91,0.1)", border: "1px solid var(--gold)" }}>
          <div className="font-bold mb-3 flex items-center gap-2" style={{ color: "var(--gold)" }}><Bell size={16} /> تنبيهات فرق ساعات العمل (محتاجة موافقتك)</div>
          <div className="flex flex-col gap-2">
            {payAdjustments.filter((p) => p.status === "pending").map((p) => {
              const s = staff.find((x) => x.id === p.staffId);
              return (
                <div key={p.id} className="rounded-xl p-3 flex flex-wrap items-center gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <div className="flex-1 min-w-[220px]">
                    <div className="font-semibold">{s?.name || "—"} · {fmtDate(p.date)}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      اشتغل {p.hoursWorked} ساعة بدل {p.standardHours} — {p.type === "deduction" ? "ناقص" : "زيادة"} {Math.abs(p.diffHours)} ساعة
                    </div>
                  </div>
                  <Badge tone={p.type === "deduction" ? "red" : "green"}>{p.type === "deduction" ? "خصم" : "مكافأة"} {EGP(p.amount)}</Badge>
                  <Btn onClick={() => {
                    setWithdrawals((w) => [...w, { id: uid(), staffId: p.staffId, type: p.type, amount: p.amount, date: p.date, note: `فرق ساعات العمل: اشتغل ${p.hoursWorked} ساعة بدل ${p.standardHours} ساعة` }]);
                    setPayAdjustments((list) => list.filter((x) => x.id !== p.id));
                    showToast("تمت الموافقة وتنفيذ العملية");
                  }}><Check size={14} /> موافقة</Btn>
                  <Btn variant="danger" onClick={() => { setPayAdjustments((list) => list.filter((x) => x.id !== p.id)); showToast("تم الرفض بدون أي تأثير مالي"); }}><X size={14} /> رفض</Btn>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-2xl p-5 mb-5 max-w-md" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="text-sm mb-2" style={{ color: "var(--muted)" }}>أدخل كودك الخاص لتسجيل الحضور أو الانصراف</div>
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={18} color="var(--gold)" />
          <TextInput value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="الكود الخاص بك" style={{ letterSpacing: "0.2em", textAlign: "center", fontSize: 18 }} maxLength={6} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Btn className="py-3" onClick={clockIn} disabled={checking}><LogIn size={16} /> {checking ? "جارِ التحقق من الموقع..." : "تسجيل حضور"}</Btn>
          <Btn variant="danger" className="py-3" onClick={clockOut} disabled={checking}><LogOut size={16} /> {checking ? "جارِ التحقق..." : "تسجيل انصراف"}</Btn>
        </div>
        {canManage && <div className="text-xs mt-3" style={{ color: "var(--muted)" }}>لو موظف وصل من غير ما يقدر يسجل من موبايله (زي عدم وجود نت)، استخدمي "تسجيل يدوي بوقت محدد" فوق واكتبي وقت وصوله الحقيقي.</div>}
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-bold">سجل يوم: {fmtDate(dateFilter)}</h3>
        <TextInput type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ width: 170 }} />
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--surface2)" }}>
            <tr>{["الموظف", "الحضور", "الانصراف", "مدة العمل", ""].map((h) => <th key={h} className="p-3 text-right font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {dayList.length === 0 ? <tr><td colSpan={5}><Empty text="لا توجد سجلات حضور لهذا اليوم" /></td></tr> : dayList.map((a) => {
              const s = staff.find((x) => x.id === a.staffId);
              return (
                <tr key={a.id} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                  <td className="p-3 font-medium">{s?.name || "—"}</td>
                  <td className="p-3"><Badge tone="green">{fmtTime(a.checkIn)}</Badge></td>
                  <td className="p-3">{a.checkOut ? <Badge tone="red">{fmtTime(a.checkOut)}</Badge> : <Badge>لم ينصرف بعد</Badge>}</td>
                  <td className="p-3">{duration(a)}</td>
                  <td className="p-3 flex gap-2">
                    {canManage && <button onClick={() => { setEditId(a.id); setManualModal(true); }}><Pencil size={14} color="var(--gold)" /></button>}
                    {canManage && <button onClick={() => del(a.id)}><Trash2 size={15} color="var(--red)" /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {manualModal && (
        <Modal title={editId ? "تعديل سجل الحضور" : "تسجيل حضور يدوي بوقت محدد"} onClose={() => { setManualModal(false); setEditId(null); }}>
          <ManualAttendanceForm staff={staff} initial={editId ? attendance.find((a) => a.id === editId) : null} onSave={saveManual} />
        </Modal>
      )}
    </div>
  );
}

function ManualAttendanceForm({ staff, initial, onSave }) {
  const toLocalInput = (iso) => { const d = iso ? new Date(iso) : new Date(); const pad = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const [staffId, setStaffId] = useState(initial?.staffId || staff[0]?.id || "");
  const [checkIn, setCheckIn] = useState(toLocalInput(initial?.checkIn));
  const [hasCheckOut, setHasCheckOut] = useState(!!initial?.checkOut);
  const [checkOut, setCheckOut] = useState(initial?.checkOut ? toLocalInput(initial.checkOut) : "");

  const submit = () => {
    if (!staffId || !checkIn) return;
    const checkInISO = new Date(checkIn).toISOString();
    const checkOutISO = hasCheckOut && checkOut ? new Date(checkOut).toISOString() : null;
    onSave({ staffId, date: checkIn.slice(0, 10), checkIn: checkInISO, checkOut: checkOutISO });
  };

  return (
    <div>
      <Field label="الموظف">
        <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="وقت الحضور الفعلي">
        <TextInput type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 mb-3 text-sm">
        <input type="checkbox" checked={hasCheckOut} onChange={(e) => { setHasCheckOut(e.target.checked); if (e.target.checked && !checkOut) setCheckOut(toLocalInput()); }} />
        سجّل وقت انصراف كمان (اسيبها فاضية لو لسه حاضر)
      </label>
      {hasCheckOut && (
        <Field label="وقت الانصراف">
          <TextInput type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </Field>
      )}
      <Btn className="w-full" disabled={!staffId || !checkIn} onClick={submit}>حفظ</Btn>
    </div>
  );
}
function Customers({ customers, setCustomers, sales, staff, showToast }) {
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const filtered = customers.filter((c) => c.name.includes(search) || c.phone.includes(search));

  const save = (data) => {
    if (data.id) setCustomers((cs) => cs.map((c) => (c.id === data.id ? data : c)));
    else setCustomers((cs) => [...cs, { ...data, id: uid(), visits: 0, totalSpent: 0, lastVisit: null, points: 0 }]);
    setModal(null); showToast("تم الحفظ");
  };
  const del = (id) => { setCustomers((cs) => cs.filter((c) => c.id !== id)); showToast("تم الحذف"); };

  if (detail) {
    const myHistory = sales.filter((s) => s.customerId === detail.id).sort((a, b) => new Date(b.date) - new Date(a.date));
    const fav = staff.find((s) => s.id === detail.favoriteBarberId);
    return (
      <div>
        <button onClick={() => setDetail(null)} className="text-sm mb-4 flex items-center gap-1" style={{ color: "var(--gold)" }}><ChevronRight size={14} /> رجوع للعملاء</button>
        <div className="display-font text-2xl mb-1">{detail.name}</div>
        <div className="text-sm mb-4" style={{ color: "var(--muted)" }}><Phone size={12} className="inline" /> {detail.phone} {fav && `· الحلاق المفضل: ${fav.name}`}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatCard icon={Users} label="عدد الزيارات" value={detail.visits} />
          <StatCard icon={DollarSign} label="إجمالي الإنفاق" value={EGP(detail.totalSpent)} accent />
          <StatCard icon={Star} label="نقاط الولاء" value={detail.points || 0} />
          <StatCard icon={Clock} label="آخر زيارة" value={detail.lastVisit ? fmtDate(detail.lastVisit) : "—"} />
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="p-3 font-bold" style={{ background: "var(--surface2)" }}>سجل الزيارات والفواتير</div>
          {myHistory.length === 0 ? <Empty text="لا توجد زيارات بعد" /> : myHistory.map((s) => (
            <div key={s.id} className="p-3 text-sm" style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
              <div className="flex justify-between mb-1"><span className="font-semibold">{s.number}</span><span style={{ color: "var(--muted)" }}>{fmtDate(s.date)}</span><span className="font-semibold" style={{ color: "var(--gold)" }}>{EGP(s.total)}</span></div>
              <div style={{ color: "var(--muted)" }}>{s.items.map((i) => i.name).join("، ")}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4 gap-2 flex-wrap">
        <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>العملاء</h2>
        <div className="flex gap-2">
          <TextInput placeholder="بحث بالاسم أو الهاتف..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
          <Btn onClick={() => setModal({ edit: null })}><Plus size={16} /> عميل جديد</Btn>
        </div>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--surface2)" }}><tr>{["الاسم", "الهاتف", "الزيارات", "الإنفاق", "آخر زيارة", ""].map((h) => <th key={h} className="p-3 text-right font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {filtered.slice(0, 100).map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                <td className="p-3 font-medium cursor-pointer" onClick={() => setDetail(c)}>{c.name}</td>
                <td className="p-3">{c.phone}</td><td className="p-3">{c.visits}</td><td className="p-3">{EGP(c.totalSpent)}</td>
                <td className="p-3">{c.lastVisit ? fmtDate(c.lastVisit) : "—"}</td>
                <td className="p-3 flex gap-2">
                  <button onClick={() => setModal({ edit: c })}><Pencil size={15} color="var(--gold)" /></button>
                  <button onClick={() => del(c.id)}><Trash2 size={15} color="var(--red)" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <Modal title={modal.edit ? "تعديل عميل" : "عميل جديد"} onClose={() => setModal(null)}><CustomerForm initial={modal.edit} onSave={save} /></Modal>}
    </div>
  );
}
function CustomerForm({ initial, onSave }) {
  const [f, setF] = useState(initial || { name: "", phone: "", notes: "", birthday: "" });
  return (
    <div>
      <Field label="الاسم"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="رقم الهاتف"><TextInput value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="تاريخ الميلاد"><TextInput type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field>
      <Field label="ملاحظات"><TextInput value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <Btn className="w-full" disabled={!f.name} onClick={() => onSave(f)}>حفظ</Btn>
    </div>
  );
}

/* ============================== APPOINTMENTS ============================== */
// بيحدّث نسخة حجوزات العميل العامة (عشان يشوفها في حسابه في صفحة الحجز) — إضافة أو تحديث حجز
async function upsertCustomerBookingMirror(phone, name, entry) {
  if (!phone) return;
  try {
    const ref = doc(db, "customerBookings", phone);
    const snap = await getDoc(ref);
    const current = snap.exists() ? snap.data().bookings || [] : [];
    const idx = current.findIndex((b) => b.id === entry.id);
    const updated = idx >= 0 ? current.map((b, i) => (i === idx ? { ...b, ...entry } : b)) : [...current, entry];
    await setDoc(ref, { name: name || snap.data()?.name || "", bookings: updated });
  } catch (e) {}
}
// بيشيل حجز من نسخة العميل العامة (لو اتحذف من عند الموظفين)
async function removeCustomerBookingMirror(phone, appointmentId) {
  if (!phone) return;
  try {
    const ref = doc(db, "customerBookings", phone);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const current = snap.data().bookings || [];
    await setDoc(ref, { name: snap.data().name || "", bookings: current.filter((b) => b.id !== appointmentId) });
  } catch (e) {}
}

function QueueTab({ queue, setQueue, durationStats, setDurationStats, staff, services, settingsData, showToast }) {
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [staffFilter, setStaffFilter] = useState("");
  const [manualModal, setManualModal] = useState(false);

  // Keep the shared queue document tidy: archive old/finished entries into
  // each customer's own history the first time this tab is opened.
  useEffect(() => {
    const { keep, toArchive } = pruneTerminalEntries(queue);
    if (toArchive.length > 0) {
      toArchive.forEach((e) => mirrorQueueEntryToHistory(e));
      setQueue(keep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dayList = queue
    .filter((q) => q.date === dateFilter && (!staffFilter || q.staffId === staffFilter))
    .sort((a, b) => a.queueNumber - b.queueNumber);

  const aheadCountFor = (entry) => queue.filter((e) =>
    e.staffId === entry.staffId && e.date === entry.date && e.id !== entry.id &&
    Q_ACTIVE_STATUSES.includes(e.status) && e.queueNumber < entry.queueNumber
  ).length;

  // Every state-changing action goes through this single transactional
  // updater so double-clicks / two devices editing at once stay safe.
  const transition = (id, updates, { onBefore } = {}) => {
    setQueue((list) => {
      const target = list.find((e) => e.id === id);
      if (!target) return list;
      if (onBefore) onBefore(target);
      const updated = list.map((e) => (e.id === id ? { ...e, ...updates(e), updated_at: Date.now() } : e));
      return updated;
    });
  };

  const call = (entry) => transition(entry.id, () => ({ status: Q_STATUS.CALLED, called_at: Date.now() }));
  const markArrived = (entry) => transition(entry.id, () => ({ status: Q_STATUS.ARRIVED, arrived_at: Date.now() }));
  const startService = (entry) => transition(entry.id, () => ({ status: Q_STATUS.IN_SERVICE, started_at: Date.now() }));

  const complete = (entry) => {
    const startedAt = entry.started_at || entry.called_at || Date.now();
    const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    setDurationStats((s) => updateDurationStats(s, entry.staffId, entry.serviceId, minutes));
    const finalEntry = { ...entry, status: Q_STATUS.COMPLETED, completed_at: Date.now(), updated_at: Date.now() };
    setQueue((list) => list.map((e) => (e.id === entry.id ? finalEntry : e)));
    mirrorQueueEntryToHistory(finalEntry);
    showToast(`تم إنهاء خدمة ${entry.customerName} (${minutes} دقيقة)`);
  };

  const noShow = (entry) => {
    const finalEntry = { ...entry, status: Q_STATUS.NO_SHOW, updated_at: Date.now() };
    setQueue((list) => list.map((e) => (e.id === entry.id ? finalEntry : e)));
    mirrorQueueEntryToHistory(finalEntry);
    showToast("تم تسجيل عدم الحضور");
  };

  const cancel = (entry) => {
    const finalEntry = { ...entry, status: Q_STATUS.CANCELLED, cancelled_at: Date.now(), updated_at: Date.now() };
    setQueue((list) => list.map((e) => (e.id === entry.id ? finalEntry : e)));
    mirrorQueueEntryToHistory(finalEntry);
    showToast("تم إلغاء الحجز");
  };

  // مهلة عدم الحضور: أي حجز واقف على "تم استدعاؤه" لمدة أطول من المهلة
  // المحددة في الإعدادات بيتحول تلقائيًا لـ"لم يحضر". قيد معروف: ده client-side
  // بس (مفيش Cloud Function مجدولة في المشروع)، فبيشتغل كل 20 ثانية طول ما
  // تبويب الطابور مفتوح على أي جهاز موظف — لو كل الأجهزة مقفولة هيتلحق فورًا
  // أول ما حد يفتح التبويب تاني.
  useEffect(() => {
    const graceMs = (settingsData?.noShowGraceMinutes ?? 15) * 60000;
    const tick = () => {
      const now = Date.now();
      setQueue((list) => list.map((e) => {
        if (e.status === Q_STATUS.CALLED && e.called_at && now - e.called_at > graceMs) {
          const finalEntry = { ...e, status: Q_STATUS.NO_SHOW, updated_at: now };
          mirrorQueueEntryToHistory(finalEntry);
          return finalEntry;
        }
        return e;
      }));
    };
    const interval = setInterval(tick, 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsData?.noShowGraceMinutes]);

  const addManual = (data) => {
    const sameStaffDay = queue.filter((e) => e.staffId === data.staffId && e.date === data.date && e.status !== Q_STATUS.CANCELLED);
    const nextNumber = sameStaffDay.length ? Math.max(...sameStaffDay.map((e) => e.queueNumber)) + 1 : 1;
    const sv = services.find((s) => s.id === data.serviceId); const s = staff.find((x) => x.id === data.staffId);
    const entry = {
      id: uid(), clientRequestId: uid(), branchId: "main",
      customerName: data.customerName, customerPhone: data.customerPhone,
      staffId: data.staffId, staffName: s?.name || "", serviceId: data.serviceId, serviceName: sv?.name || "", price: sv?.price ?? null,
      date: data.date, preferredPeriod: data.preferredPeriod || (settingsData.periods || DEFAULT_PERIODS)[0]?.key,
      queueNumber: nextNumber, status: Q_STATUS.WAITING,
      estimated_travel_minutes: null, on_the_way_at: null, arrived_at: null, called_at: null, started_at: null,
      completed_at: null, cancelled_at: null, created_at: Date.now(), updated_at: Date.now(),
    };
    setQueue((list) => [...list, entry]);
    setManualModal(false);
    showToast("تم إضافة العميل للطابور");
  };

  const statusColor = { waiting: "gold", on_the_way: "gold", arrived: "green", called: "green", in_service: "green", completed: "default", cancelled: "red", no_show: "red" };

  return (
    <div>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>الطابور</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <TextInput type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          <Select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} style={{ minWidth: 140 }}>
            <option value="">كل الموظفين</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Btn onClick={() => setManualModal(true)}><Plus size={16} /> إضافة للطابور</Btn>
        </div>
      </div>

      <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>
        نظام طابور ذكي — لا يوجد مواعيد بساعات ثابتة. العميل يحجز فترة مفضلة فقط ويحصل على رقم دور، والوقت المعروض له تقديري ويتغير حسب حركة الطابور.
      </div>

      {dayList.length === 0 ? <Empty text="لا يوجد أحد في الطابور لهذا اليوم" /> : (
        <div className="flex flex-col gap-2">
          {dayList.map((entry) => {
            const isActive = Q_ACTIVE_STATUSES.includes(entry.status);
            const ahead = isActive ? aheadCountFor(entry) : null;
            return (
              <div key={entry.id} className="rounded-xl p-3 flex flex-wrap items-center gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="w-12 text-center font-bold display-font text-2xl" style={{ color: "var(--gold)" }}>#{entry.queueNumber}</div>
                <div className="flex-1 min-w-[160px]">
                  <div className="font-semibold">{entry.customerName} · <span style={{ color: "var(--muted)" }}>{entry.customerPhone}</span></div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {entry.serviceName} · مع {entry.staffName}
                    {isActive && <> · أمامه {ahead} عميل</>}
                    {entry.status === Q_STATUS.ON_THE_WAY && <> · 🚗 في الطريق{entry.estimated_travel_minutes ? ` (~${entry.estimated_travel_minutes} د)` : ""}</>}
                  </div>
                </div>
                <Badge tone={statusColor[entry.status]}>{Q_STATUS_LABEL[entry.status]}</Badge>
                <div className="flex gap-1 flex-wrap">
                  {[Q_STATUS.WAITING, Q_STATUS.ON_THE_WAY].includes(entry.status) && <Btn onClick={() => call(entry)}><Bell size={14} /> نداء</Btn>}
                  {entry.status === Q_STATUS.CALLED && <Btn variant="secondary" onClick={() => markArrived(entry)}>وصل</Btn>}
                  {[Q_STATUS.CALLED, Q_STATUS.ARRIVED].includes(entry.status) && <Btn onClick={() => startService(entry)}><Clock size={14} /> بدء الخدمة</Btn>}
                  {entry.status === Q_STATUS.IN_SERVICE && <Btn onClick={() => complete(entry)}><Check size={14} /> إنهاء</Btn>}
                  {[Q_STATUS.CALLED, Q_STATUS.ARRIVED].includes(entry.status) && <Btn variant="danger" onClick={() => noShow(entry)}>لم يحضر</Btn>}
                  {isActive && <button onClick={() => cancel(entry)} title="إلغاء"><Trash2 size={15} color="var(--red)" /></button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {manualModal && (
        <Modal title="إضافة عميل للطابور يدويًا" onClose={() => setManualModal(false)}>
          <ManualQueueForm customers={[]} staff={staff} services={services} settingsData={settingsData} defaultDate={dateFilter} onSave={addManual} />
        </Modal>
      )}
    </div>
  );
}

function ManualQueueForm({ staff, services, settingsData, defaultDate, onSave }) {
  const periods = settingsData.periods && settingsData.periods.length ? settingsData.periods : DEFAULT_PERIODS;
  const [f, setF] = useState({
    customerName: "", customerPhone: "", staffId: staff[0]?.id || "", serviceId: services[0]?.id || "",
    date: defaultDate, preferredPeriod: periods[0]?.key || "",
  });
  return (
    <div>
      <Field label="اسم العميل"><TextInput value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></Field>
      <Field label="رقم التليفون"><TextInput value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} /></Field>
      <Field label="الموظف"><Select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="الخدمة"><Select value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="التاريخ"><TextInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="الفترة المفضلة"><Select value={f.preferredPeriod} onChange={(e) => setF({ ...f, preferredPeriod: e.target.value })}>{periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select></Field>
      </div>
      <Btn className="w-full" disabled={!f.customerName.trim() || !f.customerPhone.trim()} onClick={() => onSave(f)}>إضافة للطابور</Btn>
    </div>
  );
}

/* ============================== INVENTORY ============================== */
function Inventory({ products, setProducts, showToast }) {
  const [modal, setModal] = useState(null);
  const save = (data) => {
    if (data.id) setProducts((p) => p.map((x) => (x.id === data.id ? data : x)));
    else setProducts((p) => [...p, { ...data, id: uid() }]);
    setModal(null); showToast("تم الحفظ");
  };
  const del = (id) => setProducts((p) => p.filter((x) => x.id !== id));
  const adjust = (id, delta) => setProducts((p) => p.map((x) => (x.id === id ? { ...x, qty: Math.max(0, x.qty + delta) } : x)));
  const lowStock = products.filter((p) => p.qty <= p.minQty);

  return (
    <div>
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>المخزون والمنتجات</h2>
        <Btn onClick={() => setModal({ edit: null })}><Plus size={16} /> منتج جديد</Btn>
      </div>
      {lowStock.length > 0 && (
        <div className="rounded-xl p-3 mb-4 flex items-center gap-2 text-sm" style={{ background: "rgba(154,44,44,0.15)", border: "1px solid var(--red)", color: "#E38686" }}>
          <AlertTriangle size={16} /> {lowStock.length} منتج أوشك على النفاد: {lowStock.map((p) => p.name).slice(0, 4).join("، ")}
        </div>
      )}
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--surface2)" }}><tr>{["المنتج", "شراء", "بيع", "الكمية", "الحد الأدنى", ""].map((h) => <th key={h} className="p-3 text-right font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                <td className="p-3 font-medium">{p.name}</td>
                <td className="p-3">{EGP(p.buyPrice)}</td>
                <td className="p-3">{EGP(p.sellPrice)}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => adjust(p.id, -1)} className="w-6 h-6 rounded" style={{ background: "var(--surface2)" }}>-</button>
                    <span className={p.qty <= p.minQty ? "font-bold" : ""} style={{ color: p.qty <= p.minQty ? "var(--red)" : "var(--text)" }}>{p.qty}</span>
                    <button onClick={() => adjust(p.id, 1)} className="w-6 h-6 rounded" style={{ background: "var(--surface2)" }}>+</button>
                  </div>
                </td>
                <td className="p-3">{p.minQty}</td>
                <td className="p-3 flex gap-2">
                  <button onClick={() => setModal({ edit: p })}><Pencil size={15} color="var(--gold)" /></button>
                  <button onClick={() => del(p.id)}><Trash2 size={15} color="var(--red)" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <Modal title={modal.edit ? "تعديل منتج" : "منتج جديد"} onClose={() => setModal(null)}><ProductForm initial={modal.edit} onSave={save} /></Modal>}
    </div>
  );
}
function ProductForm({ initial, onSave }) {
  const [f, setF] = useState(initial || { name: "", buyPrice: 0, sellPrice: 0, qty: 0, minQty: 5, supplier: "", barcode: "" });
  return (
    <div>
      <Field label="اسم المنتج"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="سعر الشراء"><TextInput type="number" value={f.buyPrice} onChange={(e) => setF({ ...f, buyPrice: Number(e.target.value) })} /></Field>
        <Field label="سعر البيع"><TextInput type="number" value={f.sellPrice} onChange={(e) => setF({ ...f, sellPrice: Number(e.target.value) })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الكمية"><TextInput type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field>
        <Field label="الحد الأدنى"><TextInput type="number" value={f.minQty} onChange={(e) => setF({ ...f, minQty: Number(e.target.value) })} /></Field>
      </div>
      <Field label="المورد"><TextInput value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
      <Btn className="w-full" disabled={!f.name} onClick={() => onSave(f)}>حفظ</Btn>
    </div>
  );
}

/* ============================== EXPENSES ============================== */
const EXPENSE_TYPES = ["إيجار", "كهرباء", "مياه", "إنترنت", "رواتب", "صيانة", "منتجات", "تسويق", "سحب المالك (قبض شخصي)", "أخرى"];
function Expenses({ expenses, setExpenses, showToast }) {
  const [modal, setModal] = useState(false);
  const save = (data) => { setExpenses((e) => [...e, { ...data, id: uid() }]); setModal(false); showToast("تم تسجيل المصروف"); };
  const del = (id) => setExpenses((e) => e.filter((x) => x.id !== id));
  const total = expenses.reduce((a, e) => a + e.amount, 0);
  const byType = {};
  expenses.forEach((e) => { byType[e.type] = (byType[e.type] || 0) + e.amount; });

  return (
    <div>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>المصروفات</h2>
        <Btn onClick={() => setModal(true)}><Plus size={16} /> مصروف جديد</Btn>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard icon={Wallet} label="إجمالي المصروفات" value={EGP(total)} accent />
        {Object.entries(byType).slice(0, 3).map(([t, v]) => <StatCard key={t} icon={Receipt} label={t} value={EGP(v)} />)}
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--surface2)" }}><tr>{["النوع", "القيمة", "التاريخ", "ملاحظات", ""].map((h) => <th key={h} className="p-3 text-right font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {[...expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                <td className="p-3">{e.type}</td><td className="p-3">{EGP(e.amount)}</td><td className="p-3">{fmtDate(e.date)}</td>
                <td className="p-3" style={{ color: "var(--muted)" }}>{e.note || "—"}</td>
                <td className="p-3"><button onClick={() => del(e.id)}><Trash2 size={15} color="var(--red)" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <Modal title="مصروف جديد" onClose={() => setModal(false)}><ExpenseForm onSave={save} /></Modal>}
    </div>
  );
}
function ExpenseForm({ onSave }) {
  const [f, setF] = useState({ type: EXPENSE_TYPES[0], amount: 0, date: todayISO(), note: "" });
  return (
    <div>
      <Field label="النوع"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{EXPENSE_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="القيمة"><TextInput type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></Field>
      <Field label="التاريخ"><TextInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="ملاحظات"><TextInput value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <Btn className="w-full" onClick={() => onSave(f)}>حفظ</Btn>
    </div>
  );
}

/* ============================== INVOICES ============================== */
function InvoicesTab({ sales, setSales, staff, customers, role, showToast }) {
  const [dateFilter, setDateFilter] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const canDelete = role === "owner";

  const list = [...sales]
    .filter((s) => !dateFilter || s.date.slice(0, 10) === dateFilter)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const del = (id) => { setSales((s) => s.filter((x) => x.id !== id)); setConfirmId(null); showToast("تم حذف الفاتورة"); };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>الفواتير</h2>
        <div className="flex items-center gap-2">
          <TextInput type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ width: 170 }} />
          {dateFilter && <button onClick={() => setDateFilter("")} className="text-xs" style={{ color: "var(--gold)" }}>كل الفواتير</button>}
        </div>
      </div>
      {!canDelete && <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>حذف الفواتير متاح لصاحب المحل بس.</div>}

      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--surface2)" }}>
            <tr>{["رقم الفاتورة", "التاريخ", "العميل", "الحلاق", "الإجمالي", ""].map((h) => <th key={h} className="p-3 text-right font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.length === 0 ? <tr><td colSpan={6}><Empty text="لا توجد فواتير" /></td></tr> : list.map((s) => {
              const c = customers.find((x) => x.id === s.customerId);
              const st = staff.find((x) => x.id === s.staffId);
              return (
                <tr key={s.id} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                  <td className="p-3 font-medium">{s.number}</td>
                  <td className="p-3">{fmtDate(s.date)} {fmtTime(s.date)}</td>
                  <td className="p-3">{c?.name || "عميل مباشر"}</td>
                  <td className="p-3">{st?.name || "—"}</td>
                  <td className="p-3 font-semibold">{EGP(s.total)}</td>
                  <td className="p-3">
                    {canDelete && (
                      confirmId === s.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => del(s.id)} className="text-xs px-2 py-1 rounded" style={{ background: "var(--red)", color: "#fff" }}>تأكيد الحذف</button>
                          <button onClick={() => setConfirmId(null)} className="text-xs px-2 py-1 rounded" style={{ background: "var(--surface2)" }}>إلغاء</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmId(s.id)}><Trash2 size={15} color="var(--red)" /></button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================== REPORTS ============================== */
const REPORT_TYPES = [
  "detailed_summary", "employee_statement", "sales", "profit", "expenses", "barber_performance", "barber_commission",
  "customers", "appointments", "services", "products", "payments",
];
const REPORT_LABEL = {
  detailed_summary: "التقرير الشامل (يومي/أسبوعي/شهري)", employee_statement: "كشف حساب موظف",
  sales: "تقرير المبيعات", profit: "تقرير الأرباح", expenses: "تقرير المصروفات",
  barber_performance: "أداء الحلاقين", barber_commission: "عمولات الحلاقين", customers: "تقرير العملاء",
  appointments: "تقرير الحجوزات", services: "تقرير الخدمات", products: "مبيعات المنتجات", payments: "طرق الدفع",
};
function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
function Reports({ sales, staff, services, products, customers, expenses, appointments, queue, withdrawals }) {
  const [type, setType] = useState("sales");
  const [staffId, setStaffId] = useState("");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayISO());

  const applyPreset = (preset) => {
    const t = new Date();
    if (preset === "day") { setFrom(todayISO()); setTo(todayISO()); }
    else if (preset === "week") { const w = new Date(t); w.setDate(t.getDate() - 6); setFrom(w.toISOString().slice(0, 10)); setTo(todayISO()); }
    else if (preset === "month") { const m = new Date(t.getFullYear(), t.getMonth(), 1); setFrom(m.toISOString().slice(0, 10)); setTo(todayISO()); }
  };

  const inRange = (d) => { const dt = new Date(d); return dt >= new Date(from) && dt <= new Date(to + "T23:59:59"); };
  const rangeSales = sales.filter((s) => inRange(s.date));
  const rangeExpenses = expenses.filter((e) => inRange(e.date));
  const rangeAppts = appointments.filter((a) => inRange(a.date));
  const rangeWithdrawals = (withdrawals || []).filter((w) => inRange(w.date));

  // الموجود في الدرج حتى نهاية الفترة المختارة (منذ أول عملية اتسجلت في البرنامج)
  const upToDate = (d) => new Date(d) <= new Date(to + "T23:59:59");
  const drawerAsOfTo = sales.filter((s) => upToDate(s.date)).reduce((a, s) => a + s.total, 0)
    - expenses.filter((e) => upToDate(e.date)).reduce((a, e) => a + e.amount, 0)
    - (withdrawals || []).filter((w) => upToDate(w.date)).reduce((a, w) => a + w.amount, 0);

  let headers = [], rows = [], totalLabel = "", totalValue = "";
  let customBody = null;

  if (type === "detailed_summary") {
    const revenue = rangeSales.reduce((a, s) => a + s.total, 0);
    const commission = rangeSales.reduce((a, s) => a + s.items.reduce((x, i) => x + (i.commission || 0), 0), 0);
    const expTotal = rangeExpenses.reduce((a, e) => a + e.amount, 0);
    const withdrawTotal = rangeWithdrawals.reduce((a, w) => a + w.amount, 0);
    const netProfit = revenue - commission - expTotal;

    const perStaff = staff.map((s) => {
      const mine = rangeSales.filter((sl) => sl.staffId === s.id);
      const earned = mine.reduce((a, sl) => a + sl.items.reduce((x, i) => x + (i.commission || 0), 0), 0);
      const myWithdrawals = rangeWithdrawals.filter((w) => w.staffId === s.id);
      const withdrawn = myWithdrawals.reduce((a, w) => a + wSign(w) * w.amount, 0);
      return { name: s.name, invoices: mine.length, earned, withdrawn, net: earned + withdrawn };
    }).filter((r) => r.invoices > 0 || r.withdrawn !== 0);

    // تفصيل كل يوم على حدة بترتيب زمني
    const dayList = [];
    for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
      dayList.push(d.toISOString().slice(0, 10));
    }
    const perDay = dayList.map((d) => {
      const dSales = rangeSales.filter((sl) => sl.date.slice(0, 10) === d).sort((a, b) => new Date(a.date) - new Date(b.date));
      const dExpenses = rangeExpenses.filter((e) => e.date.slice(0, 10) === d);
      const dWithdrawals = rangeWithdrawals.filter((w) => w.date.slice(0, 10) === d);
      const dRevenue = dSales.reduce((a, sl) => a + sl.total, 0);
      const dCommission = dSales.reduce((a, sl) => a + sl.items.reduce((x, i) => x + (i.commission || 0), 0), 0);
      const dExpTotal = dExpenses.reduce((a, e) => a + e.amount, 0);
      const dWithdrawTotal = dWithdrawals.reduce((a, w) => a + w.amount, 0);
      const dNet = dRevenue - dCommission - dExpTotal;
      const dDrawer = dRevenue - dExpTotal - dWithdrawTotal;
      return { date: d, sales: dSales, revenue: dRevenue, expenses: dExpTotal, withdrawals: dWithdrawTotal, commission: dCommission, net: dNet, drawer: dDrawer, hasData: dSales.length > 0 || dExpenses.length > 0 || dWithdrawals.length > 0 };
    }).filter((d) => d.hasData);

    customBody = (
      <div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatCard icon={DollarSign} label="إجمالي الدخل" value={EGP(revenue)} accent />
          <StatCard icon={Wallet} label="عمولات الحلاقين" value={EGP(commission)} />
          <StatCard icon={AlertTriangle} label="المصروفات" value={EGP(expTotal)} />
          <StatCard icon={Banknote} label="السحوبات (سلف/مكافآت/خصومات)" value={EGP(withdrawTotal)} />
          <StatCard icon={TrendingUp} label="صافي الربح" value={EGP(netProfit)} sub={netProfit >= 0 ? "ربح ✓" : "خسارة"} />
          <StatCard icon={Receipt} label="الموجود في الدرج (حتى نهاية الفترة)" value={EGP(drawerAsOfTo)} accent />
        </div>
        <div className="mb-5">
          <div className="font-bold mb-3 flex items-center gap-2 text-lg" style={{ color: "var(--gold)" }}><Calendar size={17} /> تفصيل الفواتير يوم بيوم</div>
          {perDay.length === 0 ? (
            <Empty text="لا توجد بيانات في هذه الفترة" />
          ) : perDay.map((d) => (
            <div key={d.date} className="rounded-2xl overflow-hidden mb-4" style={{ border: "1px solid var(--border)" }}>
              <div className="p-3 font-bold" style={{ background: "var(--surface2)", color: "var(--gold)" }}>{fmtDate(d.date)}</div>
              <table className="w-full text-sm">
                <thead style={{ background: "var(--surface2)" }}>
                  <tr>{["رقم الفاتورة", "الوقت", "العميل", "الحلاق", "الإجمالي"].map((h) => <th key={h} className="p-2 text-right font-semibold" style={{ fontSize: 12 }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {d.sales.length === 0 ? <tr><td colSpan={5}><Empty text="لا توجد فواتير في هذا اليوم" /></td></tr> : d.sales.map((sl) => {
                    const c = customers.find((x) => x.id === sl.customerId);
                    const st = staff.find((x) => x.id === sl.staffId);
                    return (
                      <tr key={sl.id} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                        <td className="p-2">{sl.number}</td>
                        <td className="p-2">{fmtTime(sl.date)}</td>
                        <td className="p-2">{c?.name || "عميل مباشر"}</td>
                        <td className="p-2">{st?.name || "—"}</td>
                        <td className="p-2 font-semibold">{EGP(sl.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-3" style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
                <div className="rounded-lg p-2 text-center" style={{ background: "var(--surface2)" }}>
                  <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>دخل اليوم</div>
                  <div className="font-bold" style={{ color: "var(--gold)" }}>{EGP(d.revenue)}</div>
                </div>
                <div className="rounded-lg p-2 text-center" style={{ background: "var(--surface2)" }}>
                  <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>عمولات الحلاقين</div>
                  <div className="font-bold">{EGP(d.commission)}</div>
                </div>
                <div className="rounded-lg p-2 text-center" style={{ background: "var(--surface2)" }}>
                  <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>المصروفات</div>
                  <div className="font-bold">{EGP(d.expenses)}</div>
                </div>
                <div className="rounded-lg p-2 text-center" style={{ background: "var(--surface2)" }}>
                  <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>السحوبات</div>
                  <div className="font-bold">{EGP(d.withdrawals)}</div>
                </div>
                <div className="rounded-lg p-2 text-center" style={{ background: "var(--surface2)" }}>
                  <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>المفروض في الدرج</div>
                  <div className="font-bold" style={{ color: d.drawer >= 0 ? "var(--green)" : "var(--red)" }}>{EGP(d.drawer)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="p-3 font-bold" style={{ background: "var(--surface2)" }}>دخل كل موظف في الفترة دي</div>
          <table className="w-full text-sm">
            <thead style={{ background: "var(--surface2)" }}>
              <tr>{["الموظف", "عدد الفواتير", "دخله (عمولة/راتب)", "سلف/مكافآت/خصومات", "الصافي له"].map((h) => <th key={h} className="p-3 text-right font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {perStaff.length === 0 ? <tr><td colSpan={5}><Empty text="لا توجد بيانات في هذه الفترة" /></td></tr> : perStaff.map((r) => (
                <tr key={r.name} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3">{r.invoices}</td>
                  <td className="p-3">{EGP(r.earned)}</td>
                  <td className="p-3">{r.withdrawn >= 0 ? "+ " : "- "}{EGP(Math.abs(r.withdrawn))}</td>
                  <td className="p-3 font-semibold">{EGP(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  } else if (type === "employee_statement") {
    const s = staff.find((x) => x.id === staffId);
    if (!s) {
      customBody = <Empty text="اختاري موظف الأول من فوق" />;
    } else {
      const entries = [];
      rangeSales.filter((sl) => sl.staffId === s.id).forEach((sl) => {
        const c = sl.items.reduce((x, i) => x + (i.commission || 0), 0);
        if (c > 0) entries.push({ date: sl.date, kind: "عمولة بيع", detail: sl.number, amount: c });
      });
      rangeWithdrawals.filter((w) => w.staffId === s.id).forEach((w) => {
        entries.push({ date: w.date, kind: TYPE_LABEL[w.type] || "سلفة", detail: w.note || "—", amount: wSign(w) * w.amount });
      });
      entries.sort((a, b) => new Date(a.date) - new Date(b.date));
      let running = -(s.advance || 0);
      const withBalance = entries.map((e) => { running += e.amount; return { ...e, balance: running }; });

      headers = ["التاريخ", "نوع العملية", "التفاصيل", "المبلغ", "الرصيد بعدها"];
      rows = [
        ["—", "رصيد افتتاحي", "سلفة مسجلة في ملفه", `- ${EGP(s.advance || 0)}`, EGP(-(s.advance || 0))],
        ...withBalance.map((e) => [fmtDate(e.date), e.kind, e.detail, `${e.amount >= 0 ? "+ " : "- "}${EGP(Math.abs(e.amount))}`, EGP(e.balance)]),
      ];
      totalLabel = `الرصيد النهائي المستحق لـ ${s.name}`; totalValue = EGP(running);
    }
  } else if (type === "sales") {
    headers = ["رقم الفاتورة", "التاريخ", "العميل", "الحلاق", "الإجمالي", "طريقة الدفع"];
    rows = rangeSales.map((s) => [s.number, fmtDate(s.date), customers.find((c) => c.id === s.customerId)?.name || "زائر", staff.find((st) => st.id === s.staffId)?.name || "—", EGP(s.total), s.method]);
    totalLabel = "إجمالي المبيعات"; totalValue = EGP(rangeSales.reduce((a, s) => a + s.total, 0));
  } else if (type === "profit") {
    const revenue = rangeSales.reduce((a, s) => a + s.total, 0);
    const commission = rangeSales.reduce((a, s) => a + s.items.reduce((x, i) => x + (i.commission || 0), 0), 0);
    const expTotal = rangeExpenses.reduce((a, e) => a + e.amount, 0);
    headers = ["البند", "القيمة"];
    rows = [["الإيرادات", EGP(revenue)], ["عمولات الحلاقين", EGP(commission)], ["المصروفات", EGP(expTotal)], ["صافي الربح", EGP(revenue - commission - expTotal)]];
    totalLabel = "صافي الربح"; totalValue = EGP(revenue - commission - expTotal);
  } else if (type === "expenses") {
    headers = ["النوع", "القيمة", "التاريخ", "ملاحظات"];
    rows = rangeExpenses.map((e) => [e.type, EGP(e.amount), fmtDate(e.date), e.note || "—"]);
    totalLabel = "إجمالي المصروفات"; totalValue = EGP(rangeExpenses.reduce((a, e) => a + e.amount, 0));
  } else if (type === "barber_performance" || type === "barber_commission") {
    headers = type === "barber_performance" ? ["الحلاق", "عدد الفواتير", "إجمالي المبيعات"] : ["الحلاق", "إجمالي العمولات", "السلف", "الصافي"];
    rows = staff.map((s) => {
      const mine = rangeSales.filter((sl) => sl.staffId === s.id);
      const revenue = mine.reduce((a, sl) => a + sl.total, 0);
      const commission = mine.reduce((a, sl) => a + sl.items.reduce((x, i) => x + (i.commission || 0), 0), 0);
      return type === "barber_performance" ? [s.name, mine.length, EGP(revenue)] : [s.name, EGP(commission), EGP(s.advance || 0), EGP(commission - (s.advance || 0))];
    });
    totalLabel = "إجمالي العمولات"; totalValue = EGP(rangeSales.reduce((a, s) => a + s.items.reduce((x, i) => x + (i.commission || 0), 0), 0));
  } else if (type === "customers") {
    headers = ["العميل", "الزيارات", "إجمالي الإنفاق", "آخر زيارة"];
    rows = [...customers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 50).map((c) => [c.name, c.visits, EGP(c.totalSpent), c.lastVisit ? fmtDate(c.lastVisit) : "—"]);
    totalLabel = "عدد العملاء"; totalValue = customers.length;
  } else if (type === "appointments") {
    const rangeQueue = (queue || []).filter((q) => inRange(q.date));
    headers = ["العميل", "الحلاق", "الخدمة", "التاريخ", "رقم الدور", "الحالة"];
    rows = rangeQueue.map((q) => [q.customerName || "—", q.staffName || "—", q.serviceName || "—", fmtDate(q.date), `#${q.queueNumber}`, Q_STATUS_LABEL[q.status] || q.status]);
    totalLabel = "عدد الحجوزات"; totalValue = rangeQueue.length;
  } else if (type === "services") {
    const count = {};
    rangeSales.forEach((s) => s.items.forEach((i) => { if (i.type === "service") { count[i.name] = count[i.name] || { c: 0, r: 0 }; count[i.name].c += i.qty; count[i.name].r += i.price * i.qty; } }));
    headers = ["الخدمة", "عدد المرات", "الإيراد"];
    rows = Object.entries(count).sort((a, b) => b[1].r - a[1].r).map(([n, v]) => [n, v.c, EGP(v.r)]);
    totalLabel = "إجمالي إيراد الخدمات"; totalValue = EGP(Object.values(count).reduce((a, v) => a + v.r, 0));
  } else if (type === "products") {
    const count = {};
    rangeSales.forEach((s) => s.items.forEach((i) => { if (i.type === "product") { count[i.name] = count[i.name] || { c: 0, r: 0 }; count[i.name].c += i.qty; count[i.name].r += i.price * i.qty; } }));
    headers = ["المنتج", "الكمية المباعة", "الإيراد"];
    rows = Object.entries(count).sort((a, b) => b[1].r - a[1].r).map(([n, v]) => [n, v.c, EGP(v.r)]);
    totalLabel = "إجمالي مبيعات المنتجات"; totalValue = EGP(Object.values(count).reduce((a, v) => a + v.r, 0));
  } else if (type === "payments") {
    const count = {};
    rangeSales.forEach((s) => { count[s.method] = (count[s.method] || 0) + s.total; });
    const labelMap = { cash: "كاش", card: "فيزا/بطاقة", wallet: "محفظة" };
    headers = ["طريقة الدفع", "الإجمالي"];
    rows = Object.entries(count).map(([m, v]) => [labelMap[m] || m, EGP(v)]);
    totalLabel = "إجمالي المحصل"; totalValue = EGP(Object.values(count).reduce((a, v) => a + v, 0));
  }

  return (
    <div>
      <h2 className="display-font text-3xl mb-4" style={{ color: "var(--gold)" }}>مركز التقارير</h2>
      <div className="flex flex-wrap gap-3 mb-3 items-end">
        <Field label="نوع التقرير">
          <Select value={type} onChange={(e) => setType(e.target.value)} style={{ minWidth: 220 }}>
            {REPORT_TYPES.map((t) => <option key={t} value={t}>{REPORT_LABEL[t]}</option>)}
          </Select>
        </Field>
        {type === "employee_statement" && (
          <Field label="الموظف">
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">اختاري موظف</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="من"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="إلى"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {!customBody && <Btn variant="ghost" onClick={() => downloadCSV(`${type}.csv`, [headers, ...rows])}><Download size={15} /> تصدير CSV</Btn>}
        <Btn variant="ghost" onClick={() => window.print()}><Printer size={15} /> طباعة</Btn>
      </div>
      <div className="flex gap-2 mb-4">
        {[["day", "اليوم"], ["week", "آخر 7 أيام"], ["month", "الشهر الحالي"]].map(([k, l]) => (
          <button key={k} onClick={() => applyPreset(k)} className="px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)" }}>{l}</button>
        ))}
      </div>

      {customBody ? customBody : (
        <>
          <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="text-sm" style={{ color: "var(--muted)" }}>{totalLabel}</div>
            <div className="display-font text-3xl" style={{ color: "var(--gold)" }}>{totalValue}</div>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "var(--surface2)" }}><tr>{headers.map((h) => <th key={h} className="p-3 text-right font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={headers.length}><Empty text="لا توجد بيانات في هذه الفترة" /></td></tr> :
                  rows.map((r, i) => <tr key={i} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ============================== MY DASHBOARD (BARBER PERSONAL VIEW) ============================== */
function MyDashboardTab({ staffMember: s, staff, sales, withdrawals, setWithdrawals, attendance, setAttendance, ratings, announcements, settingsData, setPayAdjustments, showToast }) {
  const [checking, setChecking] = useState(false);
  if (!s) {
    return (
      <div className="max-w-md">
        <h2 className="display-font text-3xl mb-2" style={{ color: "var(--gold)" }}>لوحتي</h2>
        <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)" }}>
          حسابك مش مربوط بحد من الحلاقين لسه. كلّم صاحب المحل يربطك بملفك من صفحة "الفريق والصلاحيات".
        </div>
      </div>
    );
  }

  const now = new Date();
  const mySales = sales.filter((sl) => sl.staffId === s.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const monthSales = mySales.filter((sl) => { const d = new Date(sl.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const commissionAll = mySales.reduce((a, sl) => a + sl.items.reduce((x, i) => x + (i.commission || 0), 0), 0);
  const commissionMonth = monthSales.reduce((a, sl) => a + sl.items.reduce((x, i) => x + (i.commission || 0), 0), 0);
  const monthRevenue = monthSales.reduce((a, sl) => a + sl.total, 0);

  const myWithdrawals = (withdrawals || []).filter((w) => w.staffId === s.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const monthWithdrawals = myWithdrawals.filter((w) => { const d = new Date(w.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const commissionSinceSettle = mySales.filter((sl) => afterSettlement(sl.date, s)).reduce((a, sl) => a + sl.items.reduce((x, i) => x + (i.commission || 0), 0), 0);
  const adjustSinceSettle = myWithdrawals.filter((w) => afterSettlement(w.date, s)).reduce((a, w) => a + wSign(w) * w.amount, 0);
  const netDue = commissionSinceSettle - (s.advance || 0) + adjustSinceSettle;

  const myRatings = (ratings || []).filter((r) => r.staffId === s.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const avgRating = myRatings.length ? (myRatings.reduce((a, r) => a + r.stars, 0) / myRatings.length) : 0;

  const myAttendance = (attendance || []).filter((a) => a.staffId === s.id).sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn));
  const openSession = myAttendance.find((a) => !a.checkOut);
  const clockIn = async () => {
    if (openSession) { showToast("انت مسجل حضور بالفعل"); return; }
    setChecking(true);
    try { await verifyShopLocation(settingsData); } catch (err) { setChecking(false); showToast(err); return; }
    setChecking(false);
    setAttendance((a) => [...a, { id: uid(), staffId: s.id, date: todayISO(), checkIn: new Date().toISOString(), checkOut: null }]);
    if (s.payType === "daily" && s.dailyWage > 0) {
      setWithdrawals((w) => [...w, { id: uid(), staffId: s.id, type: "bonus", amount: s.dailyWage, date: todayISO(), note: `راتب يوم ${fmtDate(todayISO())} (تلقائي عند الحضور)` }]);
    }
    showToast("تم تسجيل الحضور");
  };
  const clockOut = async () => {
    if (!openSession) { showToast("مفيش تسجيل حضور مفتوح"); return; }
    setChecking(true);
    try { await verifyShopLocation(settingsData); } catch (err) { setChecking(false); showToast(err); return; }
    setChecking(false);
    const checkOutISO = new Date().toISOString();
    setAttendance((a) => a.map((x) => (x.id === openSession.id ? { ...x, checkOut: checkOutISO } : x)));
    const adj = computeDailyWageAdjustment(s, openSession.checkIn, checkOutISO);
    if (adj) {
      setPayAdjustments((list) => [...list, { id: uid(), staffId: s.id, date: todayISO(), status: "pending", createdAt: Date.now(), ...adj }]);
      showToast(`تم تسجيل الانصراف — في انتظار موافقة المدير على ${adj.type === "deduction" ? "خصم" : "مكافأة"} ${Math.abs(adj.diffHours)} ساعة`);
    } else {
      showToast("تم تسجيل الانصراف");
    }
  };
  const durMin = (a) => { if (!a.checkOut) return "—"; const mins = Math.round((new Date(a.checkOut) - new Date(a.checkIn)) / 60000); return `${Math.floor(mins / 60)}س ${mins % 60}د`; };

  return (
    <div>
      <AnnouncementBanner announcements={announcements} />
      <div className="flex items-center gap-3 mb-5">
        <div className="w-14 h-14 rounded-full flex items-center justify-center display-font text-2xl" style={{ background: "var(--surface2)", color: "var(--gold)" }}>{s.name[0]}</div>
        <div>
          <h2 className="display-font text-3xl" style={{ color: "var(--gold)" }}>أهلاً، {s.name}</h2>
          <div className="text-sm" style={{ color: "var(--muted)" }}>كود: {s.code || "—"} · {s.role === "assistant" ? "مساعد" : s.role === "manager" ? "مدير" : "حلاق"}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard icon={Wallet} label="عمولتي هذا الشهر" value={EGP(commissionMonth)} accent />
        <StatCard icon={DollarSign} label="عمولتي (كل الفترات)" value={EGP(commissionAll)} />
        <StatCard icon={Star} label="متوسط تقييمي" value={avgRating ? avgRating.toFixed(1) : "—"} />
      </div>

      {s.monthlyTarget > 0 && (
        <div className="rounded-2xl p-4 mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex justify-between text-sm mb-2">
            <span className="font-bold">التارجت الشهري</span>
            <span style={{ color: "var(--gold)" }}>{EGP(monthRevenue)} / {EGP(s.monthlyTarget)}</span>
          </div>
          <div className="w-full rounded-full overflow-hidden" style={{ background: "var(--surface2)", height: 10 }}>
            <div style={{ width: `${Math.min(100, Math.round((monthRevenue / s.monthlyTarget) * 100))}%`, background: monthRevenue >= s.monthlyTarget ? "var(--green)" : "var(--gold)", height: "100%", transition: "width .3s" }} />
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {monthRevenue >= s.monthlyTarget ? "🎉 حققتِ التارجت الشهر ده!" : `باقيلك ${EGP(Math.max(0, s.monthlyTarget - monthRevenue))} عشان توصلي التارجت`}
          </div>
        </div>
      )}

      {staff && <div className="mb-5"><Leaderboard sales={sales} staff={staff} highlightStaffId={s.id} showAmount={false} /></div>}

      <div className="rounded-2xl p-4 mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="font-bold mb-2">صافي المستحق ليّا{s.lastSettledAt ? " (بعد آخر تسوية)" : ""}</div>
        {s.lastSettledAt && <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>آخر تسوية: {fmtDate(s.lastSettledAt)}</div>}
        <div className="flex justify-between text-sm mb-1"><span style={{ color: "var(--muted)" }}>عمولاتي{s.lastSettledAt ? "" : " (كل الفترات)"}</span><span>{EGP(commissionSinceSettle)}</span></div>
        {!s.lastSettledAt && <div className="flex justify-between text-sm mb-1"><span style={{ color: "var(--muted)" }}>سلفة سابقة</span><span>- {EGP(s.advance || 0)}</span></div>}
        <div className="flex justify-between text-sm mb-2"><span style={{ color: "var(--muted)" }}>سلف / مكافآت / خصومات</span><span>{adjustSinceSettle >= 0 ? "+ " : "- "}{EGP(Math.abs(adjustSinceSettle))}</span></div>
        <div className="flex justify-between font-bold text-lg pt-2" style={{ borderTop: "1px solid var(--border)" }}><span>الصافي</span><span style={{ color: "var(--gold)" }}>{EGP(netDue)}</span></div>
      </div>

      <div className="rounded-2xl p-4 mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="font-bold mb-3">الحضور والانصراف</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <Btn className="py-3" onClick={clockIn} disabled={!!openSession || checking}><LogIn size={16} /> {checking ? "جارِ التحقق من الموقع..." : "تسجيل حضور"}</Btn>
          <Btn variant="danger" className="py-3" onClick={clockOut} disabled={!openSession || checking}><LogOut size={16} /> {checking ? "جارِ التحقق..." : "تسجيل انصراف"}</Btn>
        </div>
        {openSession && <div className="text-xs" style={{ color: "var(--green)" }}>حاضر من {fmtTime(openSession.checkIn)}</div>}
      </div>

      <div className="rounded-2xl overflow-hidden mb-5" style={{ border: "1px solid var(--border)" }}>
        <div className="p-3 font-bold" style={{ background: "var(--surface2)" }}>سجل حضوري (آخر 15 يوم)</div>
        {myAttendance.length === 0 ? <Empty text="لا يوجد سجل حضور" /> : myAttendance.slice(0, 15).map((a) => (
          <div key={a.id} className="flex justify-between text-sm p-3" style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
            <span>{fmtDate(a.checkIn)}</span>
            <Badge tone="green">{fmtTime(a.checkIn)}</Badge>
            {a.checkOut ? <Badge tone="red">{fmtTime(a.checkOut)}</Badge> : <Badge>لسه حاضر</Badge>}
            <span style={{ color: "var(--muted)" }}>{durMin(a)}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden mb-5" style={{ border: "1px solid var(--border)" }}>
        <div className="p-3 font-bold flex justify-between" style={{ background: "var(--surface2)" }}><span>سلفي ومكافآتي وخصوماتي</span></div>
        {myWithdrawals.length === 0 ? <Empty text="لا توجد عمليات مالية" /> : myWithdrawals.slice(0, 20).map((w) => (
          <div key={w.id} className="flex justify-between items-center text-sm p-3" style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
            <span>{fmtDate(w.date)}</span>
            <Badge tone={w.type === "bonus" ? "green" : w.type === "deduction" ? "red" : "gold"}>{TYPE_LABEL[w.type] || "سلفة"}</Badge>
            <span style={{ color: "var(--muted)" }}>{w.note || "—"}</span>
            <span className="font-semibold">{wSign(w) > 0 ? "+ " : "- "}{EGP(w.amount)}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="p-3 font-bold" style={{ background: "var(--surface2)" }}>تقييماتي</div>
        {myRatings.length === 0 ? <Empty text="لا توجد تقييمات بعد" /> : myRatings.map((r) => (
          <div key={r.id} className="flex justify-between items-center text-sm p-3" style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
            <span>{fmtDate(r.date)}</span>
            <span style={{ color: "var(--gold)" }}>{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</span>
            <span style={{ color: "var(--muted)" }}>{r.note || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== LEADERBOARD ============================== */
function Leaderboard({ sales, staff, highlightStaffId, showAmount = true }) {
  const now = new Date();
  const monthSales = sales.filter((s) => { const d = new Date(s.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const perf = {};
  monthSales.forEach((s) => { perf[s.staffId] = (perf[s.staffId] || 0) + s.total; });
  const ranked = staff.filter((s) => s.active !== false).map((s) => ({ staff: s, revenue: perf[s.id] || 0 })).sort((a, b) => b.revenue - a.revenue);
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <div className="p-3 font-bold flex items-center gap-2" style={{ background: "var(--surface2)" }}><TrendingUp size={16} color="var(--gold)" /> ترتيب المبيعات هذا الشهر</div>
      {ranked.length === 0 ? <Empty text="لا توجد مبيعات بعد" /> : ranked.map((r, i) => (
        <div key={r.staff.id} className="flex items-center gap-3 text-sm p-3" style={{ borderTop: "1px solid var(--border)", background: r.staff.id === highlightStaffId ? "rgba(198,161,91,0.1)" : "var(--surface)" }}>
          <div className="w-7 text-center font-bold" style={{ color: "var(--gold)" }}>{medals[i] || i + 1}</div>
          <div className="flex-1 font-semibold">{r.staff.name}{r.staff.id === highlightStaffId && <span className="mr-2"><Badge tone="gold">أنت</Badge></span>}</div>
          {showAmount && <div className="font-semibold">{EGP(r.revenue)}</div>}
        </div>
      ))}
    </div>
  );
}

function AnnouncementBanner({ announcements }) {
  const recent = [...(announcements || [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  if (recent.length === 0) return null;
  return (
    <div className="rounded-2xl p-4 mb-5" style={{ background: "rgba(198,161,91,0.1)", border: "1px solid var(--gold)" }}>
      <div className="font-bold mb-2 flex items-center gap-2" style={{ color: "var(--gold)" }}><Bell size={16} /> إعلانات المحل</div>
      <div className="flex flex-col gap-2">
        {recent.map((a) => (
          <div key={a.id} className="text-sm">
            <span>{a.text}</span>
            <span className="text-xs mr-2" style={{ color: "var(--muted)" }}>({fmtDate(new Date(a.createdAt))})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== ANNOUNCEMENTS ============================== */
function AnnouncementsTab({ announcements, setAnnouncements, showToast }) {
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    setAnnouncements([...announcements, { id: uid(), text: text.trim(), createdAt: Date.now() }]);
    setText(""); showToast("تم نشر الإعلان");
  };
  const del = (id) => setAnnouncements(announcements.filter((a) => a.id !== id));
  const sorted = [...announcements].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="max-w-xl">
      <h2 className="display-font text-3xl mb-1" style={{ color: "var(--gold)" }}>الإعلانات</h2>
      <div className="text-sm mb-4" style={{ color: "var(--muted)" }}>أي إعلان تنشريه هنا هيظهر لكل الفريق (كل الحلاقين والموظفين) في شاشتهم الرئيسية.</div>

      <div className="rounded-2xl p-4 mb-4 flex flex-col gap-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتبي الإعلان هنا... مثال: اجتماع الساعة 5 النهاردة" />
        <Btn onClick={add}><Plus size={16} /> نشر الإعلان</Btn>
      </div>

      <div className="flex flex-col gap-2">
        {sorted.length === 0 ? <Empty text="لا توجد إعلانات" /> : sorted.map((a) => (
          <div key={a.id} className="rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div>
              <div className="text-sm">{a.text}</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>{fmtDate(new Date(a.createdAt))}</div>
            </div>
            <button onClick={() => del(a.id)}><Trash2 size={15} color="var(--red)" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== TEAM / ROLES ============================== */
function TeamTab({ team, setTeam, myEmail, showToast, staff }) {
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("cashier");
  const [newStaffId, setNewStaffId] = useState(staff?.[0]?.id || "");
  const ownersCount = team.filter((t) => t.role === "owner").length;

  const [creating, setCreating] = useState(false);
  const addMember = async () => {
    if (newRole === "barber") {
      if (!newStaffId) { showToast("اختار الحلاق المرتبط بالحساب ده"); return; }
      const s = (staff || []).find((x) => x.id === newStaffId);
      if (!s?.code) { showToast("لازم يكون للحلاق ده كود حضور مسجل في ملفه الأول"); return; }
      if (!s?.loginPin || s.loginPin.length < 6) { showToast("لازم تحطي كلمة سر من 6 أرقام لدخول الحلاق ده في ملفه (تبويب الحلاقون) الأول"); return; }
      const email = staffLoginEmail(s.code);
      if (team.some((t) => t.email.toLowerCase() === email)) { showToast("الحلاق ده عنده حساب بالفعل"); return; }
      setCreating(true);
      try {
        const secondary = initializeApp(firebaseConfig, "secondary-" + Date.now());
        const secondaryAuth = getAuth(secondary);
        try {
          await createUserWithEmailAndPassword(secondaryAuth, email, s.loginPin);
        } catch (err) {
          if (err.code !== "auth/email-already-in-use") throw err;
        }
        await signOutSecondary(secondaryAuth);
        setTeam([...team, { email, role: "barber", staffId: newStaffId, addedAt: Date.now() }]);
        showToast(`تم إنشاء حساب ${s.name} — هيدخل بكوده وكلمة السر بتاعته`);
      } catch (err) {
        showToast("حصل خطأ في إنشاء الحساب، حاولي تاني");
      }
      setCreating(false);
      return;
    }
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) { showToast("اكتب إيميل صحيح"); return; }
    if (team.some((t) => t.email.toLowerCase() === email)) { showToast("الإيميل ده مضاف بالفعل"); return; }
    setTeam([...team, { email, role: newRole, staffId: null, addedAt: Date.now() }]);
    setNewEmail("");
    showToast("تمت إضافة العضو — لازم تعمل له حساب دخول في Firebase Authentication كمان لو لسه معملوش");
  };

  const changeRole = (email, role) => {
    if (email === myEmail && role !== "owner" && ownersCount <= 1) { showToast("لازم يفضل صاحب محل واحد على الأقل"); return; }
    setTeam(team.map((t) => (t.email === email ? { ...t, role, staffId: role === "barber" ? (t.staffId || staff?.[0]?.id || null) : null } : t)));
  };

  const changeStaffLink = (email, staffId) => {
    setTeam(team.map((t) => (t.email === email ? { ...t, staffId } : t)));
  };

  const removeMember = (email) => {
    if (email === myEmail) { showToast("متقدرش تشيل نفسك"); return; }
    const target = team.find((t) => t.email === email);
    if (target?.role === "owner" && ownersCount <= 1) { showToast("لازم يفضل صاحب محل واحد على الأقل"); return; }
    setTeam(team.filter((t) => t.email !== email));
  };

  return (
    <div className="max-w-xl">
      <h2 className="display-font text-3xl mb-1" style={{ color: "var(--gold)" }}>الفريق والصلاحيات</h2>
      <div className="text-sm mb-1" style={{ color: "var(--muted)" }}>حدد مين يقدر يدخل البرنامج ويشوف إيه.</div>

      <div className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        لإضافة <b style={{ color: "var(--gold)" }}>حلاق</b>، اختاريه من القائمة بس — البرنامج هيعمله حساب دخول تلقائيًا برقم تليفونه وكوده الشخصي المسجلين في ملفه (مش محتاجة تدخلي Firebase). لإضافة مدير/كاشير/صاحب محل، لازم تعمليله الأول حساب دخول (إيميل وباسورد) من Firebase Console → Authentication → Users، وبعدين تضيفيه هنا بنفس الإيميل.
      </div>

      <div className="rounded-2xl p-4 mb-4 flex flex-col gap-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        {newRole !== "barber" && (
          <TextInput placeholder="إيميل العضو (زي المسجل في Firebase)" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        )}
        <div className="flex flex-col md:flex-row gap-2">
          <Select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="manager">مدير</option>
            <option value="cashier">موظف / كاشير</option>
            <option value="barber">حلاق (حساب شخصي)</option>
            <option value="owner">صاحب المحل</option>
          </Select>
          {newRole === "barber" && (
            <Select value={newStaffId} onChange={(e) => setNewStaffId(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">اختار الحلاق</option>
              {(staff || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          <Btn onClick={addMember} disabled={creating}>{creating ? "جارِ الإنشاء..." : <><Plus size={16} /> إضافة</>}</Btn>
        </div>
        {newRole === "barber" && newStaffId && (
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            هيدخل بكوده <b style={{ color: "var(--gold)" }}>{staff?.find((s) => s.id === newStaffId)?.code}</b> وكلمة السر اللي حطيتيها في ملفه.
          </div>
        )}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--surface2)" }}>
            <tr>
              <th className="p-3 text-right font-semibold">الإيميل</th>
              <th className="p-3 text-right font-semibold">الصلاحية</th>
              <th className="p-3 text-right font-semibold">مرتبط بـ</th>
              <th className="p-3 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {team.map((t) => (
              <tr key={t.email} style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                <td className="p-3">{t.email}{t.email === myEmail && <span className="mr-2"><Badge tone="gold">أنت</Badge></span>}</td>
                <td className="p-3">
                  <Select value={t.role} onChange={(e) => changeRole(t.email, e.target.value)}>
                    <option value="owner">صاحب المحل</option>
                    <option value="manager">مدير</option>
                    <option value="cashier">موظف / كاشير</option>
                    <option value="barber">حلاق</option>
                  </Select>
                </td>
                <td className="p-3">
                  {t.role === "barber" ? (
                    <Select value={t.staffId || ""} onChange={(e) => changeStaffLink(t.email, e.target.value)}>
                      <option value="">اختار الحلاق</option>
                      {(staff || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  ) : <span style={{ color: "var(--muted)" }}>—</span>}
                </td>
                <td className="p-3 text-left">
                  <button onClick={() => removeMember(t.email)}><Trash2 size={16} color="var(--red)" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs mt-4 leading-6" style={{ color: "var(--muted)" }}>
        <b style={{ color: "var(--gold)" }}>صاحب المحل:</b> كل الصلاحيات بدون استثناء.<br />
        <b style={{ color: "var(--gold)" }}>مدير:</b> كل حاجة ما عدا الإعدادات وإدارة الفريق.<br />
        <b style={{ color: "var(--gold)" }}>موظف / كاشير:</b> الكاشير، الحجوزات، الحضور والانصراف، والعملاء بس.<br />
        <b style={{ color: "var(--gold)" }}>حلاق:</b> لوحة شخصية بس — يشوف عمولاته وسحوباته وحضوره وتقييماته هو بس.
      </div>
    </div>
  );
}

/* ============================== SETTINGS ============================== */
function SettingsTab({ settingsData, setSettingsData, showToast, setServices, setStaff, setCustomers, setProducts, setSales, setExpenses, setAppointments, setAttendance, setWithdrawals, setRatings, setAnnouncements }) {
  const [f, setF] = useState(settingsData);
  const [resetModal, setResetModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const CONFIRM_PHRASE = "تصفير";

  const doReset = () => {
    setServices([]); setStaff([]); setCustomers([]); setProducts([]); setSales([]);
    setExpenses([]); setAppointments([]); setAttendance([]); setWithdrawals([]);
    setRatings([]); setAnnouncements([]);
    setResetModal(false); setConfirmText("");
    showToast("تم تصفير بيانات البرنامج بالكامل");
  };

  return (
    <div className="max-w-md">
      <h2 className="display-font text-3xl mb-4" style={{ color: "var(--gold)" }}>الإعدادات</h2>
      <div className="rounded-2xl p-5 mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <Field label="اسم الصالون"><TextInput value={f.salonName} onChange={(e) => setF({ ...f, salonName: e.target.value })} /></Field>
        <Field label="اسم المالك"><TextInput value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
        <Field label="نقاط الولاء (نقطة لكل كام جنيه)"><TextInput type="number" value={f.pointRate} onChange={(e) => setF({ ...f, pointRate: Number(e.target.value) })} /></Field>
        <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>ساعات العمل الفعلية تتحدد من "فترات" نظام الطابور بالأسفل. العملة: الجنيه المصري (EGP) — ثابتة حاليًا.</div>
        <Btn className="w-full" onClick={() => { setSettingsData(f); showToast("تم حفظ الإعدادات"); }}>حفظ الإعدادات</Btn>
      </div>

      <div className="rounded-2xl p-5 mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="font-bold mb-3" style={{ color: "var(--gold)" }}>إعدادات نظام الطابور</div>
        <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          العميل لا يحجز ساعة ثابتة، فقط فترة مفضلة يظهرها له التطبيق. عدّل الفترات هنا حسب ما يناسب الصالون.
        </div>
        <div className="flex flex-col gap-2 mb-3">
          {(f.periods || DEFAULT_PERIODS).map((p, i) => (
            <div key={p.key} className="grid grid-cols-4 gap-2 items-center">
              <TextInput value={p.label} onChange={(e) => {
                const periods = [...(f.periods || DEFAULT_PERIODS)]; periods[i] = { ...p, label: e.target.value }; setF({ ...f, periods });
              }} />
              <TextInput type="number" min="0" max="23" value={p.startHour} onChange={(e) => {
                const periods = [...(f.periods || DEFAULT_PERIODS)]; periods[i] = { ...p, startHour: Number(e.target.value) }; setF({ ...f, periods });
              }} />
              <TextInput type="number" min="0" max="23" value={p.endHour} onChange={(e) => {
                const periods = [...(f.periods || DEFAULT_PERIODS)]; periods[i] = { ...p, endHour: Number(e.target.value) }; setF({ ...f, periods });
              }} />
              <button onClick={() => { const periods = (f.periods || DEFAULT_PERIODS).filter((_, x) => x !== i); setF({ ...f, periods }); }}>
                <Trash2 size={15} color="var(--red)" />
              </button>
            </div>
          ))}
          <Btn variant="secondary" onClick={() => {
            const periods = [...(f.periods || DEFAULT_PERIODS), { key: "p" + Date.now(), label: "فترة جديدة", startHour: 9, endHour: 12 }];
            setF({ ...f, periods });
          }}><Plus size={14} /> إضافة فترة</Btn>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="مهلة عدم الحضور (دقيقة)"><TextInput type="number" min="1" value={f.noShowGraceMinutes ?? 15} onChange={(e) => setF({ ...f, noShowGraceMinutes: Number(e.target.value) })} /></Field>
          <Field label="أقصى عدد حجوزات نشطة للعميل"><TextInput type="number" min="1" value={f.maxActiveBookingsPerCustomer ?? 1} onChange={(e) => setF({ ...f, maxActiveBookingsPerCustomer: Number(e.target.value) })} /></Field>
        </div>
        <Btn className="w-full" onClick={() => { setSettingsData(f); showToast("تم حفظ إعدادات الطابور"); }}>حفظ إعدادات الطابور</Btn>
      </div>

      <div className="rounded-2xl p-5 mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="font-bold mb-3" style={{ color: "var(--gold)" }}>التحكم في تطبيق حجز العملاء</div>
        <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          كل خيار هنا بيتحكم فعليًا في تطبيق العملاء المنفصل — مش عرض شكلي فقط.
        </div>
        <label className="flex items-center justify-between mb-3 text-sm">
          <span>فتح الحجز للعملاء الجدد</span>
          <input type="checkbox" checked={f.bookingOpen !== false} onChange={(e) => setF({ ...f, bookingOpen: e.target.checked })} />
        </label>
        <Field label="أقصى عدد حجوزات في اليوم (اتركه فاضي = بلا حد أقصى)">
          <TextInput type="number" min="0" value={f.maxBookingsPerDay ?? ""} onChange={(e) => setF({ ...f, maxBookingsPerDay: e.target.value === "" ? null : Number(e.target.value) })} />
        </Field>
        <label className="flex items-center justify-between mb-3 text-sm">
          <span>السماح للعميل باختيار الصنايعي بنفسه</span>
          <input type="checkbox" checked={f.allowEmployeeSelection !== false} onChange={(e) => setF({ ...f, allowEmployeeSelection: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between mb-3 text-sm">
          <span>عرض رقم الدور للعميل</span>
          <input type="checkbox" checked={f.showQueueNumber !== false} onChange={(e) => setF({ ...f, showQueueNumber: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between mb-3 text-sm">
          <span>عرض عدد العملاء المتبقين قبله</span>
          <input type="checkbox" checked={f.showPeopleAhead !== false} onChange={(e) => setF({ ...f, showPeopleAhead: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between mb-3 text-sm">
          <span>عرض الوقت التقريبي للانتظار</span>
          <input type="checkbox" checked={f.showEstimatedTime !== false} onChange={(e) => setF({ ...f, showEstimatedTime: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between mb-3 text-sm">
          <span>السماح للعميل بإلغاء حجزه بنفسه</span>
          <input type="checkbox" checked={f.allowCustomerCancel !== false} onChange={(e) => setF({ ...f, allowCustomerCancel: e.target.checked })} />
        </label>
        <Field label="تنبيه العميل عندما يتبقى أمامه (عدد أشخاص)">
          <TextInput type="number" min="0" value={f.approachingTurnThreshold ?? 1} onChange={(e) => setF({ ...f, approachingTurnThreshold: Number(e.target.value) })} />
        </Field>
        <Btn className="w-full" onClick={() => { setSettingsData(f); showToast("تم حفظ إعدادات تطبيق الحجز"); }}>حفظ إعدادات تطبيق الحجز</Btn>
      </div>

      <div className="rounded-2xl p-5 mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="font-bold mb-1" style={{ color: "var(--gold)" }}>ربط الحضور بموقع المحل</div>
        <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          لو فعّلتي دي، الموظفين مش هيقدروا يسجلوا حضور أو انصراف إلا وهما فعليًا واقفين في نطاق المحل. وأنتِ لازم تكوني واقفة جوه المحل دلوقتي عشان تحدديه صح.
        </div>
        {f.shopLat ? (
          <div className="text-sm mb-3 rounded-lg p-3" style={{ background: "var(--surface2)" }}>
            📍 الموقع محدد ({f.shopLat.toFixed(5)}, {f.shopLng.toFixed(5)})
          </div>
        ) : (
          <div className="text-sm mb-3" style={{ color: "var(--muted)" }}>مفيش موقع محدد — الحضور شغال من غير قيد مكان حاليًا.</div>
        )}
        <Field label="نطاق السماح (متر)"><TextInput type="number" value={f.shopRadius || 100} onChange={(e) => setF({ ...f, shopRadius: Number(e.target.value) })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Btn
            onClick={() => {
              if (!navigator.geolocation) return showToast("الجهاز ده مش بيدعم تحديد الموقع");
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  const updated = { ...f, shopLat: pos.coords.latitude, shopLng: pos.coords.longitude };
                  setF(updated); setSettingsData(updated);
                  showToast("تم تحديد موقع المحل وحفظه");
                },
                () => showToast("لازم تسمحي بصلاحية الموقع من المتصفح"),
                { enableHighAccuracy: true, timeout: 10000 }
              );
            }}
          >📍 تحديد موقع المحل الحالي</Btn>
          {f.shopLat && (
            <Btn variant="secondary" onClick={() => { const updated = { ...f, shopLat: null, shopLng: null }; setF(updated); setSettingsData(updated); showToast("تم إلغاء ربط الحضور بالموقع"); }}>
              إلغاء الربط بالموقع
            </Btn>
          )}
        </div>
      </div>

      <div className="rounded-2xl p-5" style={{ background: "rgba(154,44,44,0.08)", border: "1px solid var(--red)" }}>
        <div className="font-bold mb-1" style={{ color: "var(--red)" }}>منطقة الخطر</div>
        <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          تصفير البرنامج بيمسح كل البيانات نهائيًا: الخدمات، الحلاقين، العملاء، المنتجات، الفواتير، المصروفات، الحجوزات، الحضور، السلف، التقييمات، والإعلانات. مينفعش يترجع تاني. حساب دخولك وإعدادات الصالون هيفضلوا زي ما هم.
        </div>
        <Btn variant="danger" className="w-full" onClick={() => setResetModal(true)}>تصفير البرنامج بالكامل</Btn>
      </div>

      {resetModal && (
        <Modal title="تأكيد تصفير البرنامج" onClose={() => { setResetModal(false); setConfirmText(""); }}>
          <div className="text-sm mb-3" style={{ color: "var(--muted)" }}>
            الإجراء ده نهائي ومش هيترجع. عشان تتأكدي، اكتبي كلمة <b style={{ color: "var(--red)" }}>{CONFIRM_PHRASE}</b> في الخانة تحت.
          </div>
          <TextInput value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={CONFIRM_PHRASE} className="mb-3" />
          <Btn variant="danger" className="w-full" disabled={confirmText.trim() !== CONFIRM_PHRASE} onClick={doReset}>
            نعم، امسحي كل البيانات نهائيًا
          </Btn>
        </Modal>
      )}
    </div>
  );
}
