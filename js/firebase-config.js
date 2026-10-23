// Firebase – טעינה עצלה (Lazy).
// ה-SDK לא נטען בפתיחת האפליקציה, כדי שהמפה תעלה מיד.
// הוא ייטען רק כשפיצ'ר שצריך אותו (צ'אט, מעקב קהילתי, התחברות) יקרא ל-getFirebase().

// פרויקט walkie-4a743 (Firebase Console > Project settings > Your apps > Walkie).
// אלה מזהים ציבוריים, לא סודות: ההגנה על הנתונים היא ב-firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyDrgb1_cUKJEx86PNFkC1yvqwVfXGjL3XI',
  authDomain: 'walkie-4a743.firebaseapp.com',
  projectId: 'walkie-4a743',
  storageBucket: 'walkie-4a743.firebasestorage.app',
  messagingSenderId: '982925280376',
  appId: '1:982925280376:web:f3b1cc6f5e949ec84e998d'
  // databaseURL: להוסיף כשיוקם Realtime Database (צ'אט / מעקב קהילתי)
};

// ה-SDK ארוז עם האפליקציה (vendor/firebase), כדי שההתחברות לא תיכשל כשה-CDN לא נגיש מהמכשיר
const SDK_BASE = new URL('../vendor/firebase', import.meta.url).href;

let firebasePromise = null;

export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.startsWith('YOUR_');
}

export function getFirebase() {
  if (!isFirebaseConfigured()) {
    return Promise.reject(new Error('Firebase עדיין לא הוגדר – יש למלא את js/firebase-config.js'));
  }

  if (!firebasePromise) {
    firebasePromise = (async () => {
      const hasRtdb = !!firebaseConfig.databaseURL;
      const [appMod, authMod, firestoreMod, databaseMod] = await Promise.all([
        import(`${SDK_BASE}/firebase-app.js`),
        import(`${SDK_BASE}/firebase-auth.js`),
        import(`${SDK_BASE}/firebase-firestore.js`),
        hasRtdb ? import(`${SDK_BASE}/firebase-database.js`) : null
      ]);

      const app = appMod.initializeApp(firebaseConfig);

      return {
        app,
        auth: authMod.getAuth(app),
        firestore: firestoreMod.getFirestore(app),
        rtdb: hasRtdb ? databaseMod.getDatabase(app) : null,
        modules: {
          auth: authMod,
          firestore: firestoreMod,
          database: databaseMod
        }
      };
    })().catch((err) => {
      firebasePromise = null; // לאפשר ניסיון חוזר
      throw err;
    });
  }

  return firebasePromise;
}

// התחברות אנונימית – אפס חיכוך: המשתמש לא צריך להירשם כדי להשתתף בצ'אט/מעקב.
// מחכים קודם שהחיבור השמור ייטען (אחרת משתמש Google מחובר נראה "ריק" בפתיחה),
// ומשתפים את אותה בקשה – כדי שלא ייווצרו שני משתמשים אנונימיים במקביל.
let signInPromise = null;
export function ensureSignedIn() {
  if (!signInPromise) {
    signInPromise = (async () => {
      const { auth, modules } = await getFirebase();
      await auth.authStateReady?.();
      if (auth.currentUser) return auth.currentUser;
      const cred = await modules.auth.signInAnonymously(auth);
      return cred.user;
    })().catch((err) => {
      signInPromise = null;
      throw err;
    });
  }
  return signInPromise;
}
