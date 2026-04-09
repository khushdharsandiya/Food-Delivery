import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDefaultAdmin } from './ensureAdmin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** Seed script (`npm run seed`) aur server dono yahi URI use karein — warna data alag DB mein chala jata hai. */
export const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/Foodie_frenzy';

export const connectDB = async () => {
    await mongoose.connect(MONGO_URI).then(() => console.log('DB CONNECTED'));
    await ensureDefaultAdmin();
};