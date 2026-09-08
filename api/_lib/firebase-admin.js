import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getAdminApp() {
  if (getApps().length) return getApps()[0];

  const projectId = requiredEnv('FIREBASE_PROJECT_ID');
  const clientEmail = requiredEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = requiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

const app = getAdminApp();

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
