import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// ============================================================
// NEW FIREBASE PROJECT CONFIGURATION
// Must be the EXACT SAME config object as ../admin-app/src/firebase.js
// (both apps talk to one shared Firebase project).
//
// Where to get them:
//   Firebase Console -> (your new project) -> Project settings (gear icon)
//   -> scroll to "Your apps" -> Web app -> SDK setup and configuration
//   -> "Config" radio button.
// ============================================================
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// IMPORTANT: this app must be signed in (Anonymous Auth) before it touches
// Firestore, because firestore.rules requires request.auth != null on every
// document. Anonymous Auth only proves "this is some browser session", NOT
// that the customer owns the phone number they typed in. Do not treat
// auth.uid as a verified identity anywhere; real per-customer data
// isolation would require Phone Number (OTP) authentication instead.
//
// Requires: enable "Anonymous" under Firebase Console -> Authentication ->
// Sign-in method, on your NEW project, before this app can read or write
// anything.
export function ensureAnonymousAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        unsub();
        if (user) { resolve(user); return; }
        signInAnonymously(auth).then((cred) => resolve(cred.user)).catch(reject);
      },
      reject
    );
  });
}
