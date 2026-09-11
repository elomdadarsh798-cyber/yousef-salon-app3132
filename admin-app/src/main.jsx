import React from "react";
import ReactDOM from "react-dom/client";
import BarberPro from "./App.jsx";
import Login, { useAuthUser } from "./Login.jsx";
import "./index.css";

function Root() {
  const user = useAuthUser();

  if (user === undefined) {
    return (
      <div
        dir="rtl"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B0A09",
          color: "#C6A15B",
          fontFamily: "'Cairo', sans-serif",
        }}
      >
        ...جارِ التحقق
      </div>
    );
  }

  if (!user) return <Login />;

  return <BarberPro user={user} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
