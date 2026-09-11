import React, { useState, useEffect } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "./firebase";

export function useAuthUser() {
  const [user, setUser] = useState(undefined); // undefined = لسه بيتحقق
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);
  return user;
}

export function logout() {
  return signOut(auth);
}

// موظف بيدخل بكوده الشخصي + كلمة سر منفصلة — بيتحولوا تلقائيًا لإيميل/باسورد داخليين
export const staffLoginEmail = (code) => `${code.trim().replace(/\D/g, "")}@barberpro.local`;

const inputStyle = {
  width: "100%",
  background: "#211B16",
  border: "1px solid #2C2419",
  color: "#F3EDE3",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};
const labelStyle = { display: "block", color: "#9C9284", fontSize: 13, marginBottom: 6 };

export default function Login() {
  const [mode, setMode] = useState("staff"); // staff | admin
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAdminSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError("خطأ في اسم المستخدم أو كلمة المرور");
    } finally {
      setLoading(false);
    }
  };

  const handleStaffSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, staffLoginEmail(code), pin.trim());
    } catch (err) {
      setError("الكود أو كلمة السر غلط. كلّم صاحب المحل لو مش متأكد.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0B0A09",
        fontFamily: "'Cairo', sans-serif",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#161210",
          border: "1px solid #2C2419",
          borderRadius: 16,
          padding: 28,
        }}
      >
        <h1
          style={{
            color: "#C6A15B",
            fontSize: 28,
            marginBottom: 4,
            fontFamily: "'Bebas Neue', sans-serif",
            letterSpacing: "0.03em",
            textAlign: "center",
          }}
        >
          BARBER PRO
        </h1>
        <p style={{ color: "#9C9284", fontSize: 13, marginBottom: 18, textAlign: "center" }}>
          سجّل دخولك للمتابعة
        </p>

        <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "#1F1A15", padding: 4, borderRadius: 10 }}>
          <button
            type="button"
            onClick={() => { setMode("staff"); setError(""); }}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: mode === "staff" ? "#C6A15B" : "transparent",
              color: mode === "staff" ? "#141210" : "#9C9284",
            }}
          >
            دخول الموظفين
          </button>
          <button
            type="button"
            onClick={() => { setMode("admin"); setError(""); }}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: mode === "admin" ? "#C6A15B" : "transparent",
              color: mode === "admin" ? "#141210" : "#9C9284",
            }}
          >
            دخول الإدارة
          </button>
        </div>

        {mode === "staff" ? (
          <form onSubmit={handleStaffSubmit}>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={labelStyle}>الكود الشخصي (نفس كود الحضور والانصراف)</span>
              <input
                type="text" inputMode="numeric" required value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                style={{ ...inputStyle, letterSpacing: "0.2em", textAlign: "center", fontSize: 18 }}
                placeholder="••••" maxLength={6}
              />
            </label>
            <label style={{ display: "block", marginBottom: 16 }}>
              <span style={labelStyle}>كلمة السر (6 أرقام)</span>
              <input
                type="password" inputMode="numeric" required value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                style={{ ...inputStyle, letterSpacing: "0.2em", textAlign: "center", fontSize: 18 }}
                placeholder="••••••" maxLength={6}
              />
            </label>
            {error && <div style={{ color: "#E38686", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <button type="submit" disabled={loading} style={submitStyle(loading)}>
              {loading ? "جارِ الدخول..." : "دخول"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleAdminSubmit}>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={labelStyle}>البريد الإلكتروني</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="example@salon.com" />
            </label>
            <label style={{ display: "block", marginBottom: 16 }}>
              <span style={labelStyle}>كلمة المرور</span>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} placeholder="••••••••" />
            </label>
            {error && <div style={{ color: "#E38686", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <button type="submit" disabled={loading} style={submitStyle(loading)}>
              {loading ? "جارِ الدخول..." : "دخول"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function submitStyle(loading) {
  return {
    width: "100%",
    background: "#C6A15B",
    color: "#141210",
    border: "none",
    borderRadius: 10,
    padding: "11px 0",
    fontSize: 15,
    fontWeight: 700,
    cursor: loading ? "default" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}
