# Barber Pro — نسخة نظيفة جديدة

مشروعين منفصلين يشتغلوا مع نفس مشروع Firebase واحد:

```
admin-app/               ← لوحة إدارة الصالون (كاشير، طابور، موظفين، تقارير...)
customer-booking-app/    ← تطبيق حجز العملاء (منفصل، يفتحه العميل من رابط عام)
FIRESTORE_SCHEMA.md      ← توثيق كامل لبنية قاعدة البيانات
CHANGES.md               ← كل تعديل تم في إعادة البناء هذه، وليه
```

كل البيانات دلوقتي **فاضية تمامًا**. مفيش أي اتصال بأي مشروع Firebase قديم.
اتبع الخطوات دي بالترتيب.

---

## الخطوة 1: أنشئ مشروع Firebase جديد

1. روح على https://console.firebase.google.com وسجل دخول بحساب Google.
2. اضغط **Add project**، اختار اسم (مثلاً `barbershop-yourname`)، كمّل
   الخطوات (تقدر تلغي Google Analytics، مش لازم).
3. من القائمة الجانبية: **Build → Firestore Database → Create database**.
   - اختار **Start in production mode** (هننشر Rules آمنة بعد شوية على أي حال).
   - اختار أقرب موقع سيرفر (مثلاً `eur3` أو `europe-west`).
4. اضغط أيقونة الترس ⚙️ بجانب "Project Overview" → **Project settings**.
5. في تبويب **General**، انزل لـ **Your apps** → اضغط أيقونة الويب `</>`.
6. سمّي التطبيق (مثلاً `barberpro-web`) → **Register app**. هيديك كائن
   `firebaseConfig` — سيب الصفحة مفتوحة، هتحتاجها في الخطوة 3.

## الخطوة 2: فعّل طرق تسجيل الدخول

من القائمة الجانبية: **Build → Authentication → Get started**.

1. من قائمة طرق تسجيل الدخول (Sign-in method)، فعّل **Email/Password**
   (ده لدخول الموظفين/الإدارة على `admin-app`).
2. فعّل كمان **Anonymous** (ده **ضروري** عشان `customer-booking-app` يشتغل
   خالص — بدونه هيفشل في قراءة أو كتابة أي حاجة).
3. روح لتبويب **Users** → **Add user** → أضف بريد وكلمة مرور لكل شخص هيدخل
   لوحة الإدارة (المالك، أي كاشير أو مدير). أول شخص يسجل دخول بحسابه
   **يصبح "owner" تلقائيًا** (الكود بيعمل ده لوحده أول مرة).

## الخطوة 3: حط بيانات Firebase في المشروعين

افتح **الملفين التاليين** وضع نفس القيم من الخطوة 1 في الاثنين بالظبط:

- `admin-app/src/firebase.js`
- `customer-booking-app/src/firebase.js`

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

## الخطوة 4: انشر Firestore Rules

كل مشروع فيه ملف `firestore.rules` (نفس المحتوى في الاثنين، لأنهم بيتكلموا
مع نفس مشروع Firebase). من Firebase Console:

**Firestore Database → Rules** → امسح اللي موجود → الصق محتوى
`admin-app/firestore.rules` (أو `customer-booking-app/firestore.rules`،
نفس الملف) → **Publish**.

هذه القواعد تفصل صلاحيات الموظف عن العميل — راجع التعليقات داخل الملف
لفهم القيود المعروفة (موثقة أيضًا في `CHANGES.md` و`FIRESTORE_SCHEMA.md`).

## الخطوة 5: شغّل المشروعين محليًا

يتطلب [Node.js](https://nodejs.org) مثبّت على جهازك.

```bash
cd admin-app
npm install
npm run dev
```

وفي تيرمنال تاني:

```bash
cd customer-booking-app
npm install
npm run dev
```

هيفتح كل واحد على رابط محلي منفصل (`http://localhost:5173` غالبًا). سجّل
دخول في `admin-app` بأول حساب أضفته (هيبقى تلقائيًا "owner")، وابدأ ضيف:
خدماتك، موظفينك، إعدادات الصالون — من شاشة "الإعدادات".

## الخطوة 6: Production Build

```bash
npm run build
```

على كل مشروع على حدة. المفروض ينتج فولدر `dist/` بدون أي أخطاء.

## الخطوة 7: النشر (Vercel أو Netlify)

كل مشروع (`admin-app` و`customer-booking-app`) بيتنشر **منفصل عن التاني**،
كل واحد بموقعه/رابطه الخاص:

### Vercel
1. ادفع كل مشروع لـ repository منفصل على GitHub (أو استخدم Vercel CLI مباشرة
   من فولدر المشروع: `npx vercel`).
2. من [vercel.com](https://vercel.com) → **Add New Project** → اختار الـ
   repo → Framework Preset: **Vite** (هيتعرف عليه تلقائيًا) → Deploy.

### Netlify
1. من [netlify.com](https://netlify.com) → **Add new site → Import an
   existing project** → اختار الـ repo.
2. Build command: `npm run build` — Publish directory: `dist`.

**تنبيه:** أي شخص عنده رابط `customer-booking-app` يقدر يفتحه ويحجز —
تأكد إنه مربوط بنفس مشروع Firebase، ومفيش أي بيانات حساسة (زي الرواتب)
متاحة له بفضل `firestore.rules`.

## الخطوة 8: ابدأ إدخال بيانات محلك الحقيقية

من داخل `admin-app` بعد تسجيل الدخول:

1. **الإعدادات** → اسم الصالون، اسم المالك، نقاط الولاء، فترات العمل.
2. **الحلاقون** → أضف كل موظف (اسم، هاتف، كود دخول شخصي، نوع الراتب).
3. **الخدمات** → أضف كل خدمة (اسم، سعر، مدة تقريبية، نسبة عمولة).
4. من نفس شاشة الإعدادات، اضبط **"التحكم في تطبيق حجز العملاء"** (فتح/قفل
   الحجز، حد أقصى يومي، السماح باختيار الموظف...).
5. جرّب حجز فعلي من `customer-booking-app` وتأكد إنه ظهر في تبويب "الطابور".

---

## ملفات مرجعية

- **`FIRESTORE_SCHEMA.md`** — كل collection/document، شكل البيانات، صلاحيات
  القراءة/الكتابة.
- **`CHANGES.md`** — توثيق تفصيلي لكل فرق بين هذه النسخة والنسخة الأصلية،
  وليه كل قرار اتاخد، بما فيها الأعطال الحقيقية اللي تم إصلاحها (أهمها: باج
  كان بيمسح البيانات عند فصل الاتصال المؤقت بالنت).

## قيد بيئة إعادة البناء (مهم تعرفه)

المشروع اتُبني في بيئة **بدون اتصال إنترنت**، فمقدرش أشغّل `npm install`
أو `npm run build` فعليًا أثناء البناء. اللي تم بدلًا من ذلك: فحص كامل لصحة
الـsyntax/JSX على كل الملفات المعدَّلة (صفر أخطاء). **لازم إنت تشغّل الخطوة
5 و6 فعليًا على جهازك** للتأكد النهائي — التفاصيل الكاملة في `CHANGES.md`
البند 12.
