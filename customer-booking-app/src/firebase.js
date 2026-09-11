import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBVePpKrpi4UxaYBPnzgrX5rQfRmJKmYW4",
  authDomain: "yousef-barbershop.firebaseapp.com",
  projectId: "yousef-barbershop",
  storageBucket: "yousef-barbershop.firebasestorage.app",
  messagingSenderId: "931103299700",
  appId: "1:931103299700:web:f4ad84856a0b4912b9d921",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

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
