import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

export const firebaseConfig = {
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
