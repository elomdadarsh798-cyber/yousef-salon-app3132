import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ============================================================
// NEW FIREBASE PROJECT CONFIGURATION
// Replace these values with your new Firebase Web App config.
//
// Where to get them:
//   Firebase Console -> (your new project) -> Project settings (gear icon)
//   -> scroll to "Your apps" -> Web app -> SDK setup and configuration
//   -> "Config" radio button.
//
// This file MUST use the exact same Firebase project as the customer
// booking app (../customer-booking-app/src/firebase.js) - copy the
// same config object into both.
// ============================================================
export const firebaseConfig = {
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
