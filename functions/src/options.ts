import { setGlobalOptions } from 'firebase-functions/v2';

// Imported first by index.ts so it runs before any function is defined.
// Keep functions next to the Firestore database; change when its location is chosen.
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });
