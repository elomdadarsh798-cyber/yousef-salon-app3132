import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  doc, onSnapshot, runTransaction,
} from "firebase/firestore";
import { db, ensureAnonymousAuth } from "./firebase";
import {
  Clock, Scissors, User, Phone, ChevronRight, Loader2, Car, Bell,
  AlertTriangle, X, Star, Lock,
} from "lucide-react";
import {
  DEFAULT_QUEUE_SETTINGS, STATUS, STATUS_LABEL_AR,
  TERMINAL_STATUSES, ACTIVE_AHEAD_STATUSES, TRAVEL_TIME_OPTIONS, todayISO, dayIndex, DAY_CODES,
  genId, availablePeriods, computeWaitEstimate, formatMinutesRange, statusMessage, pickAutoStaff,
} from "./lib/queue";

const GOLD = "#C6A15B";
const BG = "#0B0A09";
const SURFACE = "#161210";
const SURFACE2 = "#1F1A15";
const BORDER = "#2C2419";
const TEXT = "#F3EDE3";
const MUTED = "#9C9284";
const RED = "#E38686";
const GREEN = "#7FBF8C";

const getSavedCustomer = () => { try { return JSON.parse(localStorage.getItem("bp_customer") || "null"); } catch { return null; } };
const saveCustomer = (name, phone) => { try { localStorage.setItem("bp_customer", JSON.stringify({ name, phone })); } catch {} };
const clearSavedCustomer = () => { try { localStorage.removeItem("bp_customer"); } catch {} };

const notifKey = (phone) => `bp_notifications_${phone}`;
const getNotifications = (phone) => { try { return JSON.parse(localStorage.getItem(notifKey(phone)) || "[]"); } catch { return []; } };
const pushNotification = (phone, text) => {
  if (!phone) return;
  const list = getNotifications(phone);
  list.unshift({ id: genId(), text, createdAt: Date.now(), read: false });
  try { localStorage.setItem(notifKey(phone), JSON.stringify(list.slice(0, 30))); } catch {}
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { new Notification("BarberPro", { body: text }); } catch {}
  }
};

// ---------------------------------------------------------------------------
// Generic Firestore "single doc holds one value" hook — matches the existing
// project convention (see barberpro-app) so both apps read/write the exact
// same documents.
// ---------------------------------------------------------------------------
function useDoc(key, fallback) {
  const [data, setData] = useState(undefined); // undefined = loading
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "barberpro", key), (snap) => {
      setData(snap.exists() && snap.data().value !== undefined ? snap.data().value : fallback);
    }, () => setData(fallback));
    return () => unsub();
  }, [key]);
  return data;
}

function FontStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cairo:wght@400;500;600;700;800&display=swap');
      * { font-family: 'Cairo', sans-serif; }
      .display-font { font-family: 'Bebas Neue', 'Cairo', sans-serif; letter-spacing: 0.03em; }
    `}</style>
  );
}

function Field({ label, children, hint }) {
  return (
    <div className="mb-3">
      {label && <div className="text-sm mb-1" style={{ color: MUTED }}>{label}</div>}
      {children}
      {hint && <div className="text-xs mt-1" style={{ color: MUTED }}>{hint}</div>}
    </div>
  );
}
const inputStyle = { width: "100%", background: "#211B16", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px", color: TEXT, fontSize: 15, outline: "none" };
const TextInput = (props) => <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;

function Btn({ children, onClick, disabled, variant = "solid", className = "" }) {
  const styles = {
    solid: { background: `linear-gradient(180deg, ${GOLD}, #9A7B2F)`, color: "#1A1400" },
    secondary: { background: SURFACE2, color: TEXT, border: `1px solid ${BORDER}` },
    danger: { background: "rgba(227,134,134,0.12)", color: RED, border: `1px solid ${RED}` },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition ${className}`}
      style={{ ...styles[variant], opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {children}
    </button>
  );
}

function StepDots({ step, count = 3 }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-full transition-all" style={{ width: i === step ? 22 : 8, height: 8, background: i <= step ? GOLD : BORDER }} />
      ))}
    </div>
  );
}

function LoadingState({ text = "جارِ التحميل..." }) {
  return <div className="flex items-center justify-center gap-2 py-16" style={{ color: MUTED }}><Loader2 className="animate-spin" size={18} /> {text}</div>;
}
function EmptyState({ text }) {
  return <div className="text-sm text-center py-8" style={{ color: MUTED }}>{text}</div>;
}
function ErrorBanner({ text, onClose }) {
  if (!text) return null;
  return (
    <div className="rounded-xl p-3 mb-3 text-sm flex items-start gap-2" style={{ background: "rgba(227,134,134,0.1)", border: `1px solid ${RED}`, color: RED }}>
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{text}</div>
      {onClose && <button onClick={onClose}><X size={14} /></button>}
    </div>
  );
}

const StatusPill = ({ status }) => {
  const tone = {
    [STATUS.WAITING]: { bg: "rgba(198,161,91,0.15)", c: GOLD, dot: "🟡" },
    [STATUS.ON_THE_WAY]: { bg: "rgba(127,191,140,0.12)", c: GREEN, dot: "🚗" },
    [STATUS.ARRIVED]: { bg: "rgba(127,191,140,0.12)", c: GREEN, dot: "🟢" },
    [STATUS.CALLED]: { bg: "rgba(127,191,140,0.18)", c: GREEN, dot: "🟢" },
    [STATUS.IN_SERVICE]: { bg: "rgba(127,191,140,0.18)", c: GREEN, dot: "✂️" },
    [STATUS.COMPLETED]: { bg: SURFACE2, c: MUTED, dot: "✅" },
    [STATUS.CANCELLED]: { bg: "rgba(227,134,134,0.12)", c: RED, dot: "❌" },
    [STATUS.NO_SHOW]: { bg: "rgba(227,134,134,0.12)", c: RED, dot: "⚠️" },
  }[status] || { bg: SURFACE2, c: MUTED, dot: "" };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold" style={{ background: tone.bg, color: tone.c }}>
      {tone.dot} {STATUS_LABEL_AR[status] || status}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    ensureAnonymousAuth()
      .then(() => setAuthReady(true))
      .catch(() => setAuthError("تعذر تسجيل الدخول التلقائي. تأكد من الاتصال بالإنترنت وحاول تحديث الصفحة."));
  }, []);

  if (authError) {
    return (
      <div style={{ background: BG, color: TEXT, minHeight: "100vh" }} dir="rtl">
        <FontStyle />
        <div className="max-w-md mx-auto px-4 py-16 text-center">
          <Lock size={28} style={{ color: RED, margin: "0 auto 12px" }} />
          <div className="text-sm" style={{ color: RED }}>{authError}</div>
        </div>
      </div>
    );
  }
  if (!authReady) {
    return (
      <div style={{ background: BG, color: TEXT, minHeight: "100vh" }} dir="rtl">
        <FontStyle />
        <LoadingState />
      </div>
    );
  }
  return <BookingApp />;
}

function BookingApp() {
  const [view, setView] = useState("book"); // book | bookings
  const staffRaw = useDoc("bp_staff", []);
  const servicesRaw = useDoc("bp_services", []);
  const settingsRaw = useDoc("bp_settings", {});
  const queueRaw = useDoc("bp_queue", []);
  const durationStatsRaw = useDoc("bp_duration_stats", {});

  const staff = useMemo(() => (staffRaw || []).filter((s) => s.active !== false && s.role !== "manager" && s.role !== "assistant"), [staffRaw]);
  const services = useMemo(() => (servicesRaw || []).filter((s) => s.active !== false), [servicesRaw]);
  const settings = useMemo(() => ({ ...DEFAULT_QUEUE_SETTINGS, ...(settingsRaw || {}) }), [settingsRaw]);
  const queueList = queueRaw || [];
  const durationStats = durationStatsRaw || {};

  const identity = getSavedCustomer();

  const myActiveEntries = useMemo(
    () => (identity?.phone ? queueList.filter((e) => e.customerPhone === identity.phone && !TERMINAL_STATUSES.includes(e.status)) : []),
    [queueList, identity?.phone]
  );

  const loading = staffRaw === undefined || servicesRaw === undefined || settingsRaw === undefined || queueRaw === undefined || durationStatsRaw === undefined;

  return (
    <div style={{ background: BG, color: TEXT, minHeight: "100vh" }} dir="rtl">
      <FontStyle />
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <div className="display-font text-4xl" style={{ color: GOLD }}>{settings?.salonName || "الصالون"}</div>
          <div className="text-sm" style={{ color: MUTED }}>احجز دورك في الطابور — بدون انتظار في المحل</div>
        </div>

        <div className="flex gap-2 mb-6 rounded-xl p-1" style={{ background: SURFACE2 }}>
          <button onClick={() => setView("book")} className="flex-1 py-2 rounded-lg text-sm font-bold" style={{ background: view === "book" ? GOLD : "transparent", color: view === "book" ? "#1A1400" : MUTED }}>احجز الآن</button>
          <button onClick={() => setView("bookings")} className="flex-1 py-2 rounded-lg text-sm font-bold relative" style={{ background: view === "bookings" ? GOLD : "transparent", color: view === "bookings" ? "#1A1400" : MUTED }}>
            حجوزاتي {myActiveEntries.length > 0 && <span className="inline-block w-2 h-2 rounded-full ms-1" style={{ background: view === "bookings" ? "#1A1400" : GOLD }} />}
          </button>
        </div>

        {loading ? (
          <LoadingState />
        ) : view === "book" ? (
          settings.bookingOpen === false ? (
            <div className="rounded-2xl p-6 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
              <Lock size={22} style={{ color: MUTED, margin: "0 auto 10px" }} />
              <div className="font-bold mb-1">الحجز مغلق حاليًا</div>
              <div className="text-sm" style={{ color: MUTED }}>الصالون قافل الحجز الجديد مؤقتًا. جرب تاني بعد شوية.</div>
            </div>
          ) : (
            <BookingFlow
              staff={staff} services={services} settings={settings} queueList={queueList}
              durationStats={durationStats} identity={identity}
              onBooked={() => setView("bookings")}
            />
          )
        ) : (
          <MyBookings
            queueList={queueList} services={services} staff={staff} settings={settings}
            durationStats={durationStats} identity={identity} onGoBook={() => setView("book")}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking flow: service -> staff -> date & preferred period -> confirm
// (No time slots anywhere in this flow, by design.)
// ---------------------------------------------------------------------------
function BookingFlow({ staff, services, settings, queueList, durationStats, identity, onBooked }) {
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [period, setPeriod] = useState("");
  const [name, setName] = useState(identity?.name || "");
  const [phone, setPhone] = useState(identity?.phone || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(genId());

  const selectedStaff = staff.find((s) => s.id === staffId);
  const selectedService = services.find((s) => s.id === serviceId);
  const workDays = selectedStaff?.workDays || DAY_CODES;
  const dateAllowed = (d) => workDays.includes(DAY_CODES[dayIndex(d)]);
  const periods = useMemo(() => availablePeriods(settings.periods, date), [settings.periods, date]);

  // Only show staff who actually offer the currently-chosen service, if the
  // staff record declares a services list; otherwise show everyone active.
  const eligibleStaff = useMemo(
    () => staff.filter((s) => !s.services || s.services.length === 0 || !serviceId || s.services.includes(serviceId)),
    [staff, serviceId]
  );

  const employeeSelectionAllowed = settings.allowEmployeeSelection !== false;

  // When the admin turns off "customer picks the employee", auto-assign the
  // least-busy eligible staff member for today's real queue load, and keep
  // it up to date if the customer changes the service.
  useEffect(() => {
    if (employeeSelectionAllowed) return;
    const auto = pickAutoStaff(eligibleStaff, queueList, date);
    setStaffId(auto?.id || "");
  }, [employeeSelectionAllowed, eligibleStaff, queueList, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!name.trim() || !phone.trim()) { setError("من فضلك اكتب الاسم ورقم التليفون"); return; }
    if (!dateAllowed(date)) { setError("الموظف ده مش شغال في اليوم ده"); return; }
    if (!period) { setError("من فضلك اختر الفترة المفضلة"); return; }
    setSubmitting(true); setError("");

    try {
      const cleanPhone = phone.trim();
      const cleanName = name.trim();
      const ref = doc(db, "barberpro", "bp_queue");

      const created = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const list = snap.exists() && Array.isArray(snap.data().value) ? snap.data().value : [];

        // Idempotent re-submit protection (double click / network retry).
        const already = list.find((e) => e.clientRequestId === idempotencyKey.current);
        if (already) return already;

        // Policy: limit active bookings per customer (configurable, not hardcoded).
        const activeCount = list.filter(
          (e) => e.customerPhone === cleanPhone && !TERMINAL_STATUSES.includes(e.status)
        ).length;
        const maxActive = settings.maxActiveBookingsPerCustomer ?? 1;
        if (activeCount >= maxActive) {
          throw new Error("ACTIVE_LIMIT");
        }

        // Policy: overall daily booking cap (configurable). Checked inside the
        // same transaction as the write, so two customers booking at the same
        // moment can't both slip past the limit.
        if (settings.maxBookingsPerDay != null) {
          const todayCount = list.filter(
            (e) => e.date === date && e.status !== STATUS.CANCELLED && e.status !== STATUS.NO_SHOW
          ).length;
          if (todayCount >= settings.maxBookingsPerDay) {
            throw new Error("DAY_LIMIT");
          }
        }

        const sameStaffDay = list.filter((e) => e.staffId === staffId && e.date === date && e.status !== STATUS.CANCELLED);
        const nextNumber = sameStaffDay.length ? Math.max(...sameStaffDay.map((e) => e.queueNumber)) + 1 : 1;

        const entry = {
          id: genId(),
          clientRequestId: idempotencyKey.current,
          branchId: "main",
          customerName: cleanName,
          customerPhone: cleanPhone,
          staffId,
          staffName: selectedStaff?.name || "",
          serviceId,
          serviceName: selectedService?.name || "",
          price: selectedService?.price ?? null,
          date,
          preferredPeriod: period,
          queueNumber: nextNumber,
          status: STATUS.WAITING,
          estimated_travel_minutes: null,
          on_the_way_at: null,
          arrived_at: null,
          called_at: null,
          started_at: null,
          completed_at: null,
          cancelled_at: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        tx.set(ref, { value: [...list, entry] });
        return entry;
      });

      saveCustomer(cleanName, cleanPhone);
      pushNotification(cleanPhone, `✅ تم تأكيد حجزك، رقم دورك #${created.queueNumber}`);
      onBooked && onBooked();
    } catch (e) {
      if (e && e.message === "ACTIVE_LIMIT") {
        setError("عندك حجز نشط بالفعل. تقدر تشوف حالته من تبويب «حجوزاتي»، أو تلغيه الأول لو عايز تحجز تاني.");
      } else if (e && e.message === "DAY_LIMIT") {
        setError("الحجوزات المتاحة اليوم اتحجزت كلها. جرب يوم تاني.");
      } else {
        setError("لا يمكن تأكيد الحجز حاليًا. تحقق من الاتصال وحاول مرة أخرى.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <StepDots step={step} count={3} />

      {step === 0 && (
        <div>
          <Field label="اختر الخدمة">
            <div className="flex flex-col gap-2">
              {services.length === 0 && <EmptyState text="لا توجد خدمات متاحة حاليًا" />}
              {services.map((sv) => (
                <button key={sv.id} onClick={() => setServiceId(sv.id)} className="rounded-xl p-3 text-sm font-semibold flex items-center justify-between"
                  style={{ background: serviceId === sv.id ? "rgba(198,161,91,0.15)" : SURFACE, border: `1px solid ${serviceId === sv.id ? GOLD : BORDER}`, color: serviceId === sv.id ? GOLD : TEXT }}>
                  <span className="flex items-center gap-2"><Scissors size={16} /> {sv.name}</span>
                  <span>{sv.price} ج.م</span>
                </button>
              ))}
            </div>
          </Field>
          {employeeSelectionAllowed ? (
            <Field label="اختر الموظف">
              <div className="grid grid-cols-2 gap-2">
                {eligibleStaff.length === 0 && <div className="col-span-2"><EmptyState text="لا يوجد موظف متاح لهذه الخدمة" /></div>}
                {eligibleStaff.map((s) => (
                  <button key={s.id} onClick={() => setStaffId(s.id)} className="rounded-xl p-3 text-sm font-semibold flex flex-col items-center gap-1"
                    style={{ background: staffId === s.id ? "rgba(198,161,91,0.15)" : SURFACE, border: `1px solid ${staffId === s.id ? GOLD : BORDER}`, color: staffId === s.id ? GOLD : TEXT }}>
                    <User size={18} /> {s.name}
                  </button>
                ))}
              </div>
            </Field>
          ) : (
            serviceId && (
              <div className="rounded-xl p-3 mb-3 text-sm" style={{ background: SURFACE2, color: MUTED }}>
                {selectedStaff ? <>هيتولى خدمتك: <span style={{ color: TEXT, fontWeight: 700 }}>{selectedStaff.name}</span></> : "لا يوجد موظف متاح لهذه الخدمة حاليًا"}
              </div>
            )
          )}
          <Btn className="w-full" disabled={!staffId || !serviceId} onClick={() => setStep(1)}>التالي <ChevronRight size={16} /></Btn>
        </div>
      )}

      {step === 1 && (
        <div>
          <Field label="اختر اليوم">
            <TextInput type="date" value={date} min={todayISO()} onChange={(e) => { setDate(e.target.value); setPeriod(""); }} />
            {!dateAllowed(date) && <div className="text-xs mt-1" style={{ color: RED }}>الموظف ده مش شغال في اليوم ده</div>}
          </Field>
          <Field label="اختر الفترة المفضلة" hint="مش موعد ثابت — هي بس الفترة اللي يريحك تيجي فيها، ودورك هيتحسب حسب الطابور.">
            <div className="grid grid-cols-2 gap-2">
              {periods.length === 0 ? (
                <div className="col-span-2 text-sm text-center py-4" style={{ color: MUTED }}>مفيش فترات متاحة النهارده، جرب يوم تاني</div>
              ) : periods.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)} className="rounded-xl py-3 text-sm font-semibold flex flex-col items-center gap-0.5"
                  style={{ background: period === p.key ? GOLD : SURFACE, color: period === p.key ? "#1A1400" : TEXT, border: `1px solid ${period === p.key ? GOLD : BORDER}` }}>
                  <Clock size={15} /> {p.label}
                  <span className="text-xs" style={{ opacity: 0.75 }}>{p.startHour}:00 – {p.endHour}:00</span>
                </button>
              ))}
            </div>
          </Field>
          <div className="flex gap-2">
            <Btn variant="secondary" className="flex-1" onClick={() => setStep(0)}>رجوع</Btn>
            <Btn className="flex-1" disabled={!period || !dateAllowed(date)} onClick={() => setStep(2)}>التالي</Btn>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="rounded-xl p-3 mb-4 text-sm" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <div className="flex justify-between mb-1"><span style={{ color: MUTED }}>الموظف</span><span>{selectedStaff?.name}</span></div>
            <div className="flex justify-between mb-1"><span style={{ color: MUTED }}>الخدمة</span><span>{selectedService?.name}</span></div>
            <div className="flex justify-between mb-1"><span style={{ color: MUTED }}>اليوم</span><span>{date}</span></div>
            <div className="flex justify-between"><span style={{ color: MUTED }}>الفترة المفضلة</span><span>{(settings.periods || []).find((p) => p.key === period)?.label || period}</span></div>
          </div>
          <Field label="الاسم"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="اكتب اسمك" /></Field>
          <Field label="رقم التليفون"><TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" type="tel" /></Field>
          <ErrorBanner text={error} onClose={() => setError("")} />
          <div className="text-xs mb-3" style={{ color: MUTED }}>هتاخد رقم دور فور التأكيد، مش ميعاد بساعة ثابتة. الوقت التقديري بيتحدث لحظيًا حسب حركة الطابور.</div>
          <div className="flex gap-2">
            <Btn variant="secondary" className="flex-1" onClick={() => setStep(1)}>رجوع</Btn>
            <Btn className="flex-1" disabled={submitting} onClick={submit}>{submitting ? "جاري الحجز..." : "تأكيد الحجز"}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Bookings: current live queue tracking + history
// ---------------------------------------------------------------------------
function MyBookings({ queueList, services, staff, settings, durationStats, identity, onGoBook }) {
  const [phoneInput, setPhoneInput] = useState("");
  const [localIdentity, setLocalIdentity] = useState(identity);
  const [historyDoc, setHistoryDoc] = useState(null); // null=loading/none
  const [points, setPoints] = useState(undefined); // undefined = loading

  useEffect(() => {
    if (!localIdentity?.phone) return;
    const unsub = onSnapshot(doc(db, "customerBookings", localIdentity.phone), (snap) => {
      setHistoryDoc(snap.exists() ? snap.data().bookings || [] : []);
    }, () => setHistoryDoc([]));
    return () => unsub();
  }, [localIdentity?.phone]);

  useEffect(() => {
    if (!localIdentity?.phone) return;
    const unsub = onSnapshot(doc(db, "customerPoints", localIdentity.phone), (snap) => {
      setPoints(snap.exists() ? snap.data() : null);
    }, () => setPoints(null));
    return () => unsub();
  }, [localIdentity?.phone]);

  const login = () => {
    if (!phoneInput.trim()) return;
    const id = { name: localIdentity?.name || "", phone: phoneInput.trim() };
    saveCustomer(id.name, id.phone);
    setLocalIdentity(id);
  };
  const logout = () => { clearSavedCustomer(); setLocalIdentity(null); setHistoryDoc(null); setPoints(undefined); };

  if (!localIdentity?.phone) {
    return (
      <div>
        <Field label="اكتب رقم تليفونك لعرض حجوزاتك">
          <div className="flex gap-2">
            <TextInput value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder="01xxxxxxxxx" type="tel" />
            <Btn onClick={login}><Phone size={16} /></Btn>
          </div>
        </Field>
      </div>
    );
  }

  const myEntries = queueList.filter((e) => e.customerPhone === localIdentity.phone);
  const current = myEntries.filter((e) => !TERMINAL_STATUSES.includes(e.status)).sort((a, b) => b.created_at - a.created_at);

  // "Past" bookings come from two places: the permanent history mirror the
  // staff app writes (customerBookings/{phone}), PLUS any just-finished
  // entries that are still sitting in the live queue doc waiting to be
  // archived (the customer app itself has no write access to the history
  // doc, since it has no Firebase Auth — see firestore.rules).
  const stillInQueue = myEntries.filter((e) => TERMINAL_STATUSES.includes(e.status));
  const historyIds = new Set((historyDoc || []).map((b) => b.id));
  const past = [...(historyDoc || []), ...stillInQueue.filter((e) => !historyIds.has(e.id))]
    .sort((a, b) => (b.completed_at || b.cancelled_at || b.created_at || 0) - (a.completed_at || a.cancelled_at || a.created_at || 0));

  return (
    <div>
      <NotificationCenter phone={localIdentity.phone} />

      {points !== null && (
        <div className="rounded-2xl p-4 mb-5 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          {points === undefined ? (
            <div className="text-sm" style={{ color: MUTED }}>جارِ تحميل نقاطك...</div>
          ) : (
            <>
              <div className="text-sm mb-1" style={{ color: MUTED }}>أهلاً {points.name || localIdentity.name || ""}</div>
              <div className="display-font text-4xl mb-1" style={{ color: GOLD }}>{points.points ?? 0}</div>
              <div className="text-sm mb-2" style={{ color: MUTED }}>نقطة ولاء</div>
              <div className="flex items-center justify-center gap-1 text-sm" style={{ color: MUTED }}><Star size={14} color={GOLD} /> {points.visits ?? 0} زيارة</div>
            </>
          )}
        </div>
      )}

      <div className="font-bold mb-2" style={{ color: GOLD }}>حجزك الحالي</div>
      {current.length === 0 ? (
        <div className="rounded-xl p-5 mb-5 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="text-sm mb-3" style={{ color: MUTED }}>مفيش حجز نشط دلوقتي</div>
          <Btn onClick={onGoBook}>احجز الآن</Btn>
        </div>
      ) : (
        current.map((entry) => (
          <LiveQueueCard key={entry.id} entry={entry} queueList={queueList} services={services} durationStats={durationStats} settings={settings} identity={localIdentity} />
        ))
      )}

      <div className="font-bold mb-2 mt-6" style={{ color: GOLD }}>حجوزات سابقة</div>
      {historyDoc === null ? <LoadingState text="جارِ تحميل السجل..." /> : past.length === 0 ? (
        <EmptyState text="لا توجد حجوزات سابقة" />
      ) : (
        <div className="flex flex-col gap-2">
          {past.slice(0, 20).map((b) => (
            <div key={b.id} className="rounded-xl p-3" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
              <div className="flex justify-between text-sm mb-1"><span className="font-semibold">{b.serviceName}</span><StatusPill status={b.status} /></div>
              <div className="text-xs" style={{ color: MUTED }}>مع {b.staffName} · {b.date} {b.price ? `· ${b.price} ج.م` : ""}</div>
            </div>
          ))}
        </div>
      )}

      <button onClick={logout} className="w-full text-center text-xs mt-6" style={{ color: MUTED }}>تسجيل الخروج / تغيير الرقم</button>
    </div>
  );
}

function NotificationCenter({ phone }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(() => getNotifications(phone));
  useEffect(() => {
    const t = setInterval(() => setList(getNotifications(phone)), 4000);
    return () => clearInterval(t);
  }, [phone]);
  if (list.length === 0) return null;
  return (
    <div className="mb-4">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-bold" style={{ color: GOLD }}>
        <Bell size={16} /> الإشعارات ({list.length})
      </button>
      {open && (
        <div className="mt-2 rounded-xl p-2 flex flex-col gap-1 max-h-56 overflow-y-auto" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          {list.map((n) => (
            <div key={n.id} className="text-xs px-2 py-2 rounded-lg" style={{ background: SURFACE2, color: TEXT }}>{n.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// The single most important screen in the app: live queue tracking.
function LiveQueueCard({ entry: initialEntry, queueList, services, durationStats, settings, identity }) {
  // Always read the freshest copy from the live queue list (it may have
  // changed status/position since this card was first rendered).
  const entry = queueList.find((e) => e.id === initialEntry.id) || initialEntry;
  const [, forceTick] = useState(0);
  const prevStatusRef = useRef(entry.status);
  const [travelChoice, setTravelChoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Recompute the elapsed-time-based estimate every 30s even without a new
  // snapshot from Firestore.
  useEffect(() => {
    const t = setInterval(() => forceTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (prevStatusRef.current !== entry.status) {
      const msg = statusMessage(entry, computeWaitEstimate({ entry, queueList, services, durationStats }));
      pushNotification(identity.phone, msg);
      prevStatusRef.current = entry.status;
    }
  }, [entry.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const estimate = computeWaitEstimate({ entry, queueList, services, durationStats });
  const isTerminal = TERMINAL_STATUSES.includes(entry.status);

  // "اقترب دورك" — مبني على العدد الحقيقي الحي للي قدامه (جاي من تحديثات
  // Firestore اللحظية عبر queueList)، مش setTimeout. بيتفعل مرة واحدة فقط
  // لما العميل يعدي الحد المسموح، وبيرجع يتفعل تاني لو رجع خلف الحد (مثلاً
  // لو حجز عميل تاني اتلغى ورجع يظهر).
  const notifiedThresholdRef = useRef(false);
  useEffect(() => {
    if (isTerminal) return;
    const threshold = settings.approachingTurnThreshold ?? 1;
    if (estimate.aheadCount <= threshold) {
      if (!notifiedThresholdRef.current) {
        notifiedThresholdRef.current = true;
        pushNotification(identity.phone, "🔔 اقترب دورك — استعد للتوجه إلى الصالون");
      }
    } else {
      notifiedThresholdRef.current = false;
    }
  }, [estimate.aheadCount, isTerminal]); // eslint-disable-line react-hooks/exhaustive-deps

  const markOnTheWay = async () => {
    setBusy(true); setError("");
    try {
      const ref = doc(db, "barberpro", "bp_queue");
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const list = snap.exists() ? snap.data().value || [] : [];
        const updated = list.map((e) => {
          if (e.id !== entry.id) return e;
          if (e.status !== STATUS.WAITING) return e; // already moved on
          return { ...e, status: STATUS.ON_THE_WAY, on_the_way_at: Date.now(), estimated_travel_minutes: travelChoice, updated_at: Date.now() };
        });
        tx.set(ref, { value: updated });
      });
    } catch {
      setError("تعذر تحديث الحالة، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = async () => {
    if (settings.allowCustomerCancel === false) { setError("الإلغاء الذاتي متوقف حاليًا، كلم الصالون مباشرة."); return; }
    if (!confirm("هل تريد إلغاء هذا الحجز؟")) return;
    setBusy(true); setError("");
    try {
      const ref = doc(db, "barberpro", "bp_queue");
      let cancelled = null;
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const list = snap.exists() ? snap.data().value || [] : [];
        const updated = list.map((e) => {
          if (e.id !== entry.id) return e;
          if ([STATUS.CALLED, STATUS.IN_SERVICE, ...TERMINAL_STATUSES].includes(e.status)) return e;
          cancelled = { ...e, status: STATUS.CANCELLED, cancelled_at: Date.now(), updated_at: Date.now() };
          return cancelled;
        });
        tx.set(ref, { value: updated });
      });
      if (cancelled) {
        // Note: the customer app has no Firebase Auth, so it cannot write to
        // customerBookings/{phone} directly (that path requires auth by
        // design — see firestore.rules). The cancelled entry stays visible
        // in "My Bookings" because MyBookings also reads terminal entries
        // straight out of bp_queue; the staff app mirrors it into permanent
        // history the next time the Queue tab is opened.
        pushNotification(identity.phone, "تم إلغاء الحجز");
      } else {
        setError("مبقاش ممكن إلغاء الحجز في المرحلة دي.");
      }
    } catch {
      setError("تعذر إلغاء الحجز، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl p-5 mb-3" style={{ background: SURFACE, border: `1px solid ${entry.status === STATUS.CALLED ? GREEN : BORDER}` }}>
      <div className="flex items-center justify-between mb-3">
        {(settings.showQueueNumber ?? true) ? (
          <div className="display-font text-3xl" style={{ color: GOLD }}>#{entry.queueNumber}</div>
        ) : <div />}
        <StatusPill status={entry.status} />
      </div>
      <div className="text-sm mb-1 font-semibold">{entry.serviceName}</div>
      <div className="text-xs mb-4" style={{ color: MUTED }}>مع {entry.staffName} · {entry.date}</div>

      {!isTerminal && (settings.showPeopleAhead !== false || settings.showEstimatedTime !== false) && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {(settings.showPeopleAhead ?? true) && (
              <div className="rounded-xl p-3 text-center" style={{ background: SURFACE2 }}>
                <div className="text-xs mb-1" style={{ color: MUTED }}>أمامك</div>
                <div className="font-bold text-lg">{estimate.aheadCount} عميل</div>
              </div>
            )}
            {(settings.showEstimatedTime ?? true) && (
              <div className="rounded-xl p-3 text-center" style={{ background: SURFACE2 }}>
                <div className="text-xs mb-1" style={{ color: MUTED }}>الانتظار المتوقع</div>
                <div className="font-bold text-lg">{formatMinutesRange(estimate.lowMin, estimate.highMin)}</div>
              </div>
            )}
          </div>
          <div className="text-xs mb-4 text-center" style={{ color: MUTED }}>
            الوقت تقديري وقد يتغير حسب مدة الخدمات السابقة وحركة الطابور.
          </div>
        </>
      )}

      <ErrorBanner text={error} onClose={() => setError("")} />

      {entry.status === STATUS.WAITING && (
        <div className="mb-3">
          <Field label="بعد كام دقيقة تقدر توصل الصالون؟ (اختياري)">
            <div className="flex flex-wrap gap-2">
              {TRAVEL_TIME_OPTIONS.map((opt) => (
                <button key={String(opt.value)} onClick={() => setTravelChoice(opt.value)} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: travelChoice === opt.value ? GOLD : SURFACE2, color: travelChoice === opt.value ? "#1A1400" : TEXT, border: `1px solid ${travelChoice === opt.value ? GOLD : BORDER}` }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>
          <Btn className="w-full" disabled={busy} onClick={markOnTheWay}><Car size={16} /> أنا في الطريق</Btn>
        </div>
      )}

      {entry.status === STATUS.ON_THE_WAY && (
        <div className="rounded-xl p-3 mb-3 text-sm text-center" style={{ background: "rgba(127,191,140,0.1)", color: GREEN }}>
          🚗 تم تسجيل أنك في الطريق إلى الصالون
        </div>
      )}

      {entry.status === STATUS.CALLED && (
        <div className="rounded-xl p-3 mb-3 text-sm text-center font-bold" style={{ background: "rgba(127,191,140,0.15)", color: GREEN }}>
          🟢 حان دورك، توجه إلى الموظف الآن
        </div>
      )}

      {(settings.allowCustomerCancel ?? true) && [STATUS.WAITING, STATUS.ON_THE_WAY, STATUS.ARRIVED].includes(entry.status) && (
        <button onClick={cancelBooking} disabled={busy} className="w-full text-center text-xs mt-1" style={{ color: RED }}>إلغاء الحجز</button>
      )}
    </div>
  );
}


