const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const MONGO_URI  = process.env.MONGO_URI  || '';
const JWT_SECRET = process.env.JWT_SECRET || 'jobsphere-secret-2026';
const TRIAL_DAYS = 7;

let db;

async function getDB() {
  if (db) return db;
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('jobsphere');
  // Create indexes
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  console.log('[MongoDB] Connected');
  return db;
}

// Register new user
async function register(email, password) {
  const database = await getDB();
  const existing = await database.collection('users').findOne({ email });
  if (existing) throw new Error('Email already registered');
  const hash = await bcrypt.hash(password, 10);
  const trialEnd = new Date(Date.now() + TRIAL_DAYS * 86400000);
  const user = {
    email,
    password: hash,
    trialEnd,
    paid: false,
    paidUntil: null,
    createdAt: new Date()
  };
  const result = await database.collection('users').insertOne(user);
  const token = jwt.sign({ id: result.insertedId.toString(), email }, JWT_SECRET, { expiresIn: '30d' });
  return { token, trialEnd, paid: false };
}

// Login
async function login(email, password) {
  const database = await getDB();
  const user = await database.collection('users').findOne({ email });
  if (!user) throw new Error('Email not found');
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new Error('Wrong password');
  const token = jwt.sign({ id: user._id.toString(), email }, JWT_SECRET, { expiresIn: '30d' });
  return { token, trialEnd: user.trialEnd, paid: user.paid, paidUntil: user.paidUntil };
}

// Verify token and check access
async function checkAccess(token) {
  if (!token) return { ok: false, reason: 'not_logged_in' };
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const database = await getDB();
    const user = await database.collection('users').findOne({ _id: new ObjectId(decoded.id) });
    if (!user) return { ok: false, reason: 'not_logged_in' };

    const now = new Date();

    // Paid and still valid
    if (user.paid && user.paidUntil && new Date(user.paidUntil) > now) {
      return { ok: true, reason: 'paid', user };
    }

    // Trial still active
    if (new Date(user.trialEnd) > now) {
      const daysLeft = Math.ceil((new Date(user.trialEnd) - now) / 86400000);
      return { ok: true, reason: 'trial', daysLeft, user };
    }

    // Trial expired and not paid
    return { ok: false, reason: 'expired', user };
  } catch(e) {
    return { ok: false, reason: 'not_logged_in' };
  }
}

// Mark user as paid
async function markPaid(email, months = 1) {
  const database = await getDB();
  const paidUntil = new Date(Date.now() + months * 30 * 86400000);
  await database.collection('users').updateOne(
    { email },
    { $set: { paid: true, paidUntil } }
  );
}

// Get user by email
async function getUser(email) {
  const database = await getDB();
  return database.collection('users').findOne({ email });
}

module.exports = { register, login, checkAccess, markPaid, getUser };
