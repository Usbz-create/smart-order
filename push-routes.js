/**
 * push-routes.js — Express routes for push notification subscriptions
 *
 * SETUP:
 * 1. npm install web-push
 * 2. Generate VAPID keys once:
 *      node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k,null,2))"
 * 3. Set environment variables:
 *      VAPID_PUBLIC_KEY=...
 *      VAPID_PRIVATE_KEY=...
 *      VAPID_EMAIL=mailto:you@yourdomain.com
 * 4. In server.js:
 *      const pushRoutes = require('./push-routes');
 *      app.use('/api/push', pushRoutes);
 *
 * 5. In your HTML pages, add before </body>:
 *      <script>window.VAPID_PUBLIC_KEY = 'YOUR_PUBLIC_KEY';</script>
 *      <script src="/pwa.js"></script>
 *
 * 6. After staff login, call:
 *      SmartOrderPWA.subscribePush();
 */

const express = require('express');
const router  = express.Router();

// Lazy-load web-push so server starts even if not installed yet
let webpush;
try {
  webpush = require('web-push');
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL || 'mailto:admin@smartorder.local',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }
} catch {
  console.warn('[Push] web-push not installed. Run: npm install web-push');
}

// In-memory store — replace with your PostgreSQL table in production
// Table suggestion:
//   CREATE TABLE push_subscriptions (
//     id SERIAL PRIMARY KEY,
//     endpoint TEXT UNIQUE NOT NULL,
//     keys JSONB NOT NULL,
//     role TEXT,
//     created_at TIMESTAMPTZ DEFAULT NOW()
//   );
const subscriptions = new Map();

// ── POST /api/push/subscribe ──────────────────────────────────────────────────
router.post('/subscribe', (req, res) => {
  const { subscription, role } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ message: 'Invalid subscription' });
  }
  subscriptions.set(subscription.endpoint, { subscription, role });
  console.log(`[Push] New subscription for role: ${role}`);
  res.json({ message: 'Subscribed successfully' });
});

// ── POST /api/push/unsubscribe ────────────────────────────────────────────────
router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) subscriptions.delete(endpoint);
  res.json({ message: 'Unsubscribed' });
});

// ── POST /api/push/send ───────────────────────────────────────────────────────
// Internal endpoint — call from your order/kitchen logic
// Body: { title, body, role?, url?, requireInteraction? }
// If `role` is provided, only subscribers with that role get notified.
router.post('/send', async (req, res) => {
  if (!webpush) return res.status(503).json({ message: 'web-push not configured' });

  const { title, body, role, url, requireInteraction, tag } = req.body;
  const payload = JSON.stringify({ title, body, url, requireInteraction, tag });

  const targets = [...subscriptions.values()].filter(s => !role || s.role === role);
  const dead = [];

  const results = await Promise.allSettled(
    targets.map(({ subscription }) =>
      webpush.sendNotification(subscription, payload).catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(subscription.endpoint); // Subscription expired
        }
        throw err;
      })
    )
  );

  // Clean up expired subscriptions
  dead.forEach(ep => subscriptions.delete(ep));

  const sent = results.filter(r => r.status === 'fulfilled').length;
  res.json({ sent, total: targets.length });
});

// ── GET /api/push/vapid-public-key ───────────────────────────────────────────
// Lets the client fetch the VAPID key dynamically
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

module.exports = router;
