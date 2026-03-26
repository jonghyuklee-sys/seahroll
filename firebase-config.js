// Firebase Configuration (Project: roll-design-common)
const firebaseConfig = {
    apiKey: "AIzaSyCMJpVMWbR5FpRoSNDJJHNA2Ezjjr7g24Y",
    authDomain: "roll-design-common.firebaseapp.com",
    projectId: "roll-design-common",
    storageBucket: "roll-design-common.firebasestorage.app",
    messagingSenderId: "954605496683",
    appId: "1:954605496683:web:1f63e16f0a4e198cbdc42e"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const storage = firebase.storage();

console.log("🔥 Firebase initialized successfully.");
