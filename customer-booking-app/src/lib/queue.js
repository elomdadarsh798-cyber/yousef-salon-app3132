// ============================================================================
// Smart Queue Booking — shared constants & pure helper functions
// No Firestore calls live here on purpose: this file is pure logic so it is
// easy to reason about (and unit test) separately from the network code.
// ============================================================================

export const DEFAULT_PERIODS = [
  { key: "morning", label: "الصباح", startHour: 9, endHour: 12 },
  { key: "noon", label: "الظهر", startHour: 12, endHour: 15 },
  { key: "afternoon", label: "العصر", startHour: 15, endHour: 18 },
  { key: "evening", label: "المساء", startHour: 18, endHour: 22 },
];

export const DEFAULT_QUEUE_SETTINGS = {
  periods: DEFAULT_PERIODS,
  noShowGraceMinutes: 15,
  maxActiveBookingsPerCustomer: 1,

  // --- Booking control (set from the admin app, enforced here for real) ---
  bookingOpen: true, // المدير قافل/فاتح الحجز بالكامل
  maxBookingsPerDay: null, // null = بلا حد أقصى؛ رقم = أقصى عدد حجوزات في اليوم الواحد (كل الموظفين)
  allowEmployeeSelection: true, // false = العميل ميختارش الصنايعي، بيتحدد تلقائيًا

  // --- What the customer is shown / allowed to do in the live queue screen ---
  showQueueNumber: true,
  showPeopleAhead: true,
  showEstimatedTime: true,
  allowCustomerCancel: true,

  // عدد الأشخاص أمام العميل اللي عنده يعتبر "دورك قرّب" وتتبعت له إشعار
  approachingTurnThreshold: 1,
};

// Statuses, in their natural forward order.
export const STATUS = {
  WAITING: "waiting",
  ON_THE_WAY: "on_the_way",
  ARRIVED: "arrived",
  CALLED: "called",
  IN_SERVICE: "in_service",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
};

export const STATUS_LABEL_AR = {
  waiting: "في الانتظار",
  on_the_way: "في الطريق",
  arrived: "وصل الصالون",
  called: "تم استدعاؤك",
  in_service: "جاري تنفيذ الخدمة",
  completed: "مكتمل",
  cancelled: "ملغي",
  no_show: "لم يحضر",
};

// Statuses that still occupy a place in the line (used for "customers ahead").
export const ACTIVE_AHEAD_STATUSES = [
  STATUS.WAITING,
  STATUS.ON_THE_WAY,
  STATUS.ARRIVED,
  STATUS.CALLED,
  STATUS.IN_SERVICE,
];

// Statuses that count against "one active booking per customer" policy.
export const ACTIVE_LIMIT_STATUSES = ACTIVE_AHEAD_STATUSES;

export const TERMINAL_STATUSES = [STATUS.COMPLETED, STATUS.CANCELLED, STATUS.NO_SHOW];

export const TRAVEL_TIME_OPTIONS = [
  { value: 10, label: "10 دقائق" },
  { value: 15, label: "15 دقيقة" },
  { value: 20, label: "20 دقيقة" },
  { value: 30, label: "30 دقيقة" },
  { value: 45, label: "أكثر من 30 دقيقة" },
  { value: null, label: "لا أعرف" },
];

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const dayIndex = (dateStr) => new Date(dateStr + "T00:00:00").getDay(); // 0=Sun
export const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const round5 = (n) => Math.max(0, Math.round(n / 5) * 5);

export function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Which preferred periods are still selectable for a given date, given the
// salon's working hours. Periods that already fully passed *today* are
// excluded so customers can't "book" a slice of the day that's already gone.
export function availablePeriods(periods, date) {
  const list = periods && periods.length ? periods : DEFAULT_PERIODS;
  const isToday = date === todayISO();
  if (!isToday) return list;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return list.filter((p) => p.endHour * 60 > nowMinutes);
}

// Average expected duration (minutes) for a given staff+service, learned
// from historical completions, falling back to the service's own rough
// estimate, then to a generic default. This is ALWAYS an estimate, never a
// fixed appointment duration.
export function estimateDurationMinutes(durationStats, staffId, serviceId, service) {
  const learned = durationStats?.[staffId]?.[serviceId];
  if (learned && learned.count > 0 && learned.avgMin > 0) return learned.avgMin;
  if (service?.duration) return Number(service.duration) || 25;
  return 25;
}

// How many minutes of service are still "left" for a queue entry that is
// already in progress, given when it started and its expected duration.
function remainingMinutesForActiveEntry(entry, expectedMin) {
  if (entry.status !== STATUS.IN_SERVICE || !entry.started_at) return expectedMin;
  const elapsed = (Date.now() - entry.started_at) / 60000;
  return Math.max(3, expectedMin - elapsed);
}

// Core dynamic waiting-time estimate for one queue entry, given the full
// list of queue entries for that staff/day and the learned duration stats.
// Returns { aheadCount, lowMin, highMin } — a RANGE, never a fixed time.
export function computeWaitEstimate({ entry, queueList, services, durationStats }) {
  if (!entry) return { aheadCount: 0, lowMin: 0, highMin: 0 };
  const ahead = (queueList || []).filter(
    (e) =>
      e.staffId === entry.staffId &&
      e.date === entry.date &&
      e.branchId === entry.branchId &&
      e.id !== entry.id &&
      ACTIVE_AHEAD_STATUSES.includes(e.status) &&
      e.queueNumber < entry.queueNumber
  );

  let total = 0;
  for (const a of ahead) {
    const svc = services.find((s) => s.id === a.serviceId);
    const expected = estimateDurationMinutes(durationStats, a.staffId, a.serviceId, svc);
    total += remainingMinutesForActiveEntry(a, expected);
  }

  const lowMin = round5(total * 0.75);
  const highMin = round5(Math.max(total * 1.25, total + 10));
  return { aheadCount: ahead.length, lowMin, highMin };
}

// Used when the admin disables "let the customer pick the employee": assign
// whoever among the eligible staff currently has the fewest people waiting
// today. This is a real load-based choice, not a random pick.
export function pickAutoStaff(eligibleStaff, queueList, date) {
  if (!eligibleStaff || eligibleStaff.length === 0) return null;
  const loadFor = (staffId) =>
    (queueList || []).filter(
      (e) => e.staffId === staffId && e.date === date && ACTIVE_AHEAD_STATUSES.includes(e.status)
    ).length;
  return [...eligibleStaff].sort((a, b) => loadFor(a.id) - loadFor(b.id))[0];
}

export function formatMinutesRange(lowMin, highMin) {
  if (lowMin <= 0 && highMin <= 5) return "أقل من 5 دقائق";
  return `${lowMin}–${highMin} دقيقة`;
}

// A short, human status message used both in the live tracking screen and
// as the basis for in-app / push notification text.
export function statusMessage(entry, waitEstimate) {
  switch (entry.status) {
    case STATUS.WAITING:
      if (waitEstimate.aheadCount === 0) return "🟢 حان دورك تقريبًا — يرجى التوجه إلى الصالون";
      if (waitEstimate.aheadCount === 1) return "🟡 دورك قرب جدًا، أمامك عميل واحد فقط";
      return `أمامك ${waitEstimate.aheadCount} عملاء`;
    case STATUS.ON_THE_WAY:
      return "🚗 تم تسجيل أنك في الطريق إلى الصالون";
    case STATUS.ARRIVED:
      return "لقد وصلت — في انتظار استدعائك";
    case STATUS.CALLED:
      return "🟢 حان دورك، توجه إلى الموظف الآن";
    case STATUS.IN_SERVICE:
      return "جاري تنفيذ الخدمة الآن";
    case STATUS.COMPLETED:
      return "تم إنهاء الخدمة، نتمنى لك يومًا سعيدًا";
    case STATUS.CANCELLED:
      return "تم إلغاء هذا الحجز";
    case STATUS.NO_SHOW:
      return "تم تسجيل عدم الحضور لهذا الحجز";
    default:
      return "";
  }
}
