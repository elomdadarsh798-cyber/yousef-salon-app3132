# توثيق بنية قاعدة البيانات (Firestore Schema)

هذا الملف بيوثّق كل collection/document بيستخدمه المشروعين (لوحة الإدارة `admin-app`
وتطبيق حجز العملاء `customer-booking-app`)، وهما مربوطين بنفس مشروع Firebase واحد.

## فكرة عامة مهمة

لوحة الإدارة بتخزن كل "جدول" (موظفين، عملاء، خدمات...) في **مستند واحد** داخل
مجموعة `barberpro`، والمستند ده بيحتوي على **مصفوفة كاملة** تحت حقل اسمه `value`.
يعني مثلاً كل الموظفين موجودين في مصفوفة واحدة جوه `barberpro/bp_staff`، مش
كل موظف في مستند منفصل.

**الأثر العملي:** أي كتابة لأي عنصر واحد في القائمة بتعيد كتابة القائمة **كاملة**.
ده تصميم بسيط وسهل، لكنه معرض لمشكلة "الكتابة المتزامنة من جهازين في نفس
اللحظة تمسح تعديل التاني" (race condition) — تم تخفيف الخطر في الأماكن
الحساسة (تسجيل حجز جديد، تحديث الطابور) باستخدام Firestore Transactions
(`runTransaction`) بدل الكتابة المباشرة، لكن التحسين الجذري (نقل كل جدول
لمجموعة فرعية بمستند مستقل لكل عنصر) يحتاج إعادة هيكلة أكبر غير مطبقة هنا —
موثّق كقيد معروف في `firestore.rules` و`CHANGES.md`.

---

## Collection: `barberpro/{docId}`

كل مستند تحته حقل واحد اسمه `value` (مصفوفة أو كائن حسب المستند).

| docId | نوع value | الاستخدام | القراءة | الكتابة |
|---|---|---|---|---|
| `bp_services` | array | قائمة الخدمات (اسم، سعر، مدة، نسبة عمولة) | موظف + عميل (تطبيق الحجز) | موظف فقط |
| `bp_staff` | array | قائمة الموظفين (اسم، هاتف، كود دخول، أيام العمل، نوع الراتب) | موظف + عميل | موظف فقط |
| `bp_customers` | array | قاعدة بيانات العملاء الداخلية (زيارات، إجمالي إنفاق، نقاط) | موظف فقط | موظف فقط |
| `bp_products` | array | المخزون (اسم، سعر شراء/بيع، كمية) | موظف فقط | موظف فقط |
| `bp_sales` | array | فواتير البيع (POS) | موظف فقط | موظف فقط |
| `bp_expenses` | array | المصروفات | موظف فقط | موظف فقط |
| `bp_appointments` | array | مواعيد قديمة (نظام حجز بمواعيد ثابتة — النظام الحالي يعتمد على `bp_queue` بدل ده) | موظف فقط | موظف فقط |
| `bp_attendance` | array | سجل حضور وانصراف الموظفين | موظف فقط | موظف فقط |
| `bp_withdrawals` | array | سلف ومسحوبات الموظفين | موظف فقط | موظف فقط |
| `bp_pay_adjustments` | array | تسويات راتب يومي (خصم/مكافأة حسب ساعات الحضور) | موظف فقط | موظف فقط |
| `bp_settlements` | array | تسويات حساب الموظف (صفر الرصيد) | موظف فقط | موظف فقط |
| `bp_ratings` | array | تقييمات الموظفين (تُدخل يدويًا من الإدارة حاليًا) | موظف فقط | موظف فقط |
| `bp_announcements` | array | إعلانات داخلية تظهر للموظفين | موظف فقط | موظف فقط |
| `bp_settings` | object | إعدادات الصالون العامة (اسم الصالون، نقاط الولاء، فترات العمل، إعدادات تطبيق الحجز) — انظر تفصيل الحقول تحت | موظف + عميل | موظف فقط |
| `bp_queue` | array | الطابور الذكي (كل حجوزات اليوم/الأيام، بكل الحالات) | موظف + عميل | موظف (كل شيء) / عميل (إضافة عنصر واحد فقط أو تعديل الحجم بمقدار عنصر) |
| `bp_duration_stats` | object | متوسط مدة كل خدمة لكل موظف (متعلم تلقائيًا من الحجوزات المكتملة، لتقدير وقت الانتظار) | موظف + عميل | موظف فقط |
| `bp_team` | array | صلاحيات الدخول: كل عنصر `{ email, role, staffId? }`، role ∈ `owner/manager/cashier/barber` | موظف فقط | موظف فقط |

### تفاصيل `bp_settings.value` (أهم الحقول)

```
{
  salonName: string,          // اسم الصالون (فاضي افتراضيًا)
  ownerName: string,          // اسم المالك (فاضي افتراضيًا)
  pointRate: number,          // نقطة ولاء واحدة لكل كام جنيه (تُطبَّق فعليًا في الكاشير)
  shopLat, shopLng, shopRadius, // لربط تسجيل الحضور بموقع جغرافي (اختياري)
  periods: [{ key, label, startHour, endHour }], // فترات اليوم المعروضة للعميل عند الحجز
  noShowGraceMinutes: number,   // دقائق قبل تحويل "تم استدعاؤه" تلقائيًا لـ"لم يحضر"
  maxActiveBookingsPerCustomer: number,
  // --- تتحكم فعليًا في تطبيق حجز العملاء ---
  bookingOpen: boolean,
  maxBookingsPerDay: number|null,
  allowEmployeeSelection: boolean,
  showQueueNumber: boolean,
  showPeopleAhead: boolean,
  showEstimatedTime: boolean,
  allowCustomerCancel: boolean,
  approachingTurnThreshold: number,
}
```

### تفاصيل عنصر واحد داخل `bp_queue.value`

```
{
  id, clientRequestId, branchId,
  customerName, customerPhone,
  staffId, staffName, serviceId, serviceName, price,
  date, preferredPeriod, queueNumber,
  status: "waiting" | "on_the_way" | "arrived" | "called" | "in_service"
        | "completed" | "cancelled" | "no_show",
  estimated_travel_minutes, on_the_way_at, arrived_at, called_at,
  started_at, completed_at, cancelled_at, created_at, updated_at,
}
```

---

## Collection: `customerPoints/{phone}`

مستند لكل رقم هاتف عميل، بيتحدث كل عملية بيع من الكاشير:

```
{ name: string, points: number, visits: number }
```

- القراءة: موظف أو عميل (أي عميل — انظر القيد الأمني في `firestore.rules`).
- الكتابة: موظف فقط.

## Collection: `customerBookings/{phone}`

سجل تاريخي (آخر 50 حجز) لكل رقم هاتف، يُستخدم في شاشة "حجوزاتي" بتطبيق العملاء:

```
{ name: string, bookings: [ { ...نفس شكل عنصر bp_queue... } ] }
```

- القراءة: موظف أو عميل.
- الكتابة: موظف فقط (تطبيق العميل لا يكتب هنا مباشرة أبدًا).

---

## قيد أمني معروف ومُوثّق (وليس Bug)

مع الاعتماد فقط على **Anonymous Authentication** لتطبيق العملاء، لا توجد طريقة
في Firestore Rules للتحقق أن العميل صاحب رقم الهاتف الذي كتبه فعلاً — أي جلسة
عميل موقّعة تقدر تقرأ `customerPoints/{أي رقم}` أو `customerBookings/{أي رقم}`
لو خمّنت الرقم. الحل الكامل يحتاج **Phone Number (OTP) Authentication** بدل
Anonymous، وهو تغيير أكبر غير مطبق في هذه النسخة — موثّق في `firestore.rules`
كتعليق واضح.
