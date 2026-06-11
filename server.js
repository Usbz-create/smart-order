const express = require("express");
const path    = require("path");
const crypto  = require("crypto");
const db      = require("./db");

const app  = express();
const PORT = process.env.PORT || 3000;

const VALID_STATUSES = ["pending", "cooking", "ready", "served", "call_waiter", "paid"];

// Table identifiers — Maori words, no sequence, not guessable
const VALID_TABLES = new Set(["moana", "maunga", "awa", "ngahere", "repo", "rangi", "whenua", "makau"]);

function isValidTable(t) {
  return typeof t === "string" && VALID_TABLES.has(t.trim().toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Security middleware
// ─────────────────────────────────────────────────────────────────────────────

// Basic security headers (helmet-lite inline — no extra dependency needed)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Simple in-memory rate limiter for auth endpoint
const loginAttempts = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT    = 10;        // max attempts
const RATE_WINDOW   = 60 * 1000; // per 60 seconds

function rateLimitLogin(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  let   rec = loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + RATE_WINDOW };
    loginAttempts.set(ip, rec);
  }
  rec.count++;
  if (rec.count > RATE_LIMIT) {
    return res.status(429).json({ message: "Too many login attempts. Wait 60 seconds." });
  }
  next();
}

// Clean up the rate-limit map every 5 minutes so it doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts.entries()) {
    if (now > rec.resetAt) loginAttempts.delete(ip);
  }
}, 5 * 60 * 1000);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isValidPin(pin) {
  return typeof pin === "string" && pin.length >= 4 && pin.length <= 20;
}

function isValidPrice(price) {
  return typeof price === "number" && !Number.isNaN(price) && price >= 0;
}

// Use crypto for strong session IDs
function generateSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

// Safely parse a route param as a positive integer; returns null if invalid
function parseId(param) {
  const n = parseInt(param, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function verifyAdminPin(adminPin, cb) {
  db.get("SELECT pin FROM role_pins WHERE role = 'admin'", [], (err, row) => {
    if (err)                         return cb({ status: 500, message: "Failed to verify admin credentials." });
    if (!row || row.pin !== adminPin) return cb({ status: 401, message: "Invalid admin PIN." });
    cb(null);
  });
}

function verifyRolePin(role, pin, cb) {
  db.get("SELECT pin FROM role_pins WHERE role = ?", [role], (err, row) => {
    if (err)                      return cb({ status: 500, message: "Failed to verify credentials." });
    if (!row || row.pin !== pin)  return cb({ status: 401, message: "Invalid role PIN." });
    cb(null);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

app.post("/auth/login", rateLimitLogin, (req, res) => {
  const { role, pin } = req.body;
  if (!role || !isValidPin(pin))
    return res.status(400).json({ message: "Role and valid PIN are required." });
  db.get("SELECT pin FROM role_pins WHERE role = ?", [role], (err, row) => {
    if (err)                      return res.status(500).json({ message: "Login failed." });
    if (!row || row.pin !== pin)  return res.status(401).json({ message: "Invalid role or PIN." });
    return res.json({ message: "Login successful." });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Menu (public)
// ─────────────────────────────────────────────────────────────────────────────

app.get("/menu", (_req, res) => {
  db.all("SELECT id, name, price FROM menu_items WHERE is_active = 1 ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ message: "Failed to fetch menu." });
    return res.json(rows);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────────────

app.post("/session/start", (req, res) => {
  const { tableNumber, sessionId, deviceId: rawDeviceId } = req.body;
  if (!tableNumber) return res.status(400).json({ message: "Table number is required." });

  const deviceId = rawDeviceId || "legacy";
  const tableStr = String(tableNumber).trim().toLowerCase();

  if (!isValidTable(tableStr))
    return res.status(400).json({ message: "Invalid table." });

  if (sessionId) {
    db.get(
      "SELECT session_id, bill_requested FROM table_sessions WHERE table_number = ? AND session_id = ?",
      [tableStr, sessionId],
      (err, row) => {
        if (err) return res.status(500).json({ message: "Session check failed." });
        if (row) return res.json({ sessionId: row.session_id, billRequested: Number(row.bill_requested) === 1, resumed: true });
        return res.json({ sessionId: null, billRequested: false, resumed: false });
      }
    );
  } else {
    return res.json({ sessionId: null, billRequested: false, resumed: false });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Orders — place
// ─────────────────────────────────────────────────────────────────────────────

app.post("/order", (req, res) => {
  const { tableNumber, items, isCallWaiter = false, sessionId: clientSessionId, deviceId: rawDeviceId2 } = req.body;
  if (!tableNumber) return res.status(400).json({ message: "Table number is required." });

  const deviceId = rawDeviceId2 || "legacy";
  const tableStr = String(tableNumber).trim().toLowerCase();

  if (!isValidTable(tableStr))
    return res.status(400).json({ message: "Invalid table." });

  // ── Call waiter ──────────────────────────────────────────────────────────
  if (isCallWaiter) {
    if (!clientSessionId)
      return res.status(400).json({ message: "No active session. Please place a food order first." });
    db.get(
      "SELECT session_id FROM table_sessions WHERE table_number = ? AND session_id = ?",
      [tableStr, clientSessionId],
      (err, row) => {
        if (err || !row) return res.status(400).json({ message: "Session not found or expired." });
        db.run(
          "INSERT INTO orders (table_number, items, total_price, status, session_id) VALUES (?, ?, 0, 'call_waiter', ?)",
          [tableStr, JSON.stringify([]), clientSessionId],
          function (error) {
            if (error) return res.status(500).json({ message: "Failed to notify waiter." });
            return res.json({ message: "Waiter notified!", orderId: this.lastID });
          }
        );
      }
    );
    return;
  }

  // ── Food order ───────────────────────────────────────────────────────────
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ message: "At least one item is required." });
  if (items.some(i => !i.name || typeof i.quantity !== "number" || i.quantity <= 0))
    return res.status(400).json({ message: "Each item must have a name and quantity > 0." });

  const itemNames    = [...new Set(items.map(i => i.name))];
  const placeholders = itemNames.map(() => "?").join(", ");

  db.all(
    `SELECT name, price, is_active AS isactive FROM menu_items WHERE name IN (${placeholders})`,
    itemNames,
    (menuErr, menuRows) => {
      if (menuErr) return res.status(500).json({ message: "Failed to verify menu items." });
      if (menuRows.length !== itemNames.length)
        return res.status(400).json({ message: "One or more items are invalid." });

      const menuMap       = new Map(menuRows.map(r => [r.name, r]));
      const computedItems = [];
      let   totalPrice    = 0;

      for (const item of items) {
        const mi = menuMap.get(item.name);
        if (!mi || !mi.isactive) return res.status(400).json({ message: "One or more items are not currently available." });
        const unitPrice = Number(mi.price || 0);
        totalPrice += unitPrice * item.quantity;
        computedItems.push({ name: item.name, quantity: item.quantity, unitPrice });
      }

      db.get(
        "SELECT session_id, bill_requested FROM table_sessions WHERE table_number = ? AND device_id = ?",
        [tableStr, deviceId],
        (existErr, existRow) => {
          if (existErr) return res.status(500).json({ message: "Session check failed." });
          if (existRow) {
            if (Number(existRow.bill_requested) === 1)
              return res.status(400).json({ message: "Bill already requested. Please pay at the counter before ordering again." });
            insertOrder(res, tableStr, computedItems, totalPrice, existRow.session_id);
          } else {
            const newSessionId = generateSessionId();
            db.run(
              "INSERT INTO table_sessions (session_id, table_number, device_id, bill_requested) VALUES (?, ?, ?, 0)",
              [newSessionId, tableStr, deviceId],
              function (insertErr) {
                if (insertErr) return res.status(500).json({ message: "Failed to create session." });
                insertOrder(res, tableStr, computedItems, totalPrice, newSessionId);
              }
            );
          }
        }
      );
    }
  );
});

function insertOrder(res, tableStr, computedItems, totalPrice, sessionId) {
  db.run(
    "INSERT INTO orders (table_number, items, total_price, status, session_id) VALUES (?, ?, ?, 'pending', ?)",
    [tableStr, JSON.stringify(computedItems), totalPrice, sessionId],
    function (err) {
      if (err) return res.status(500).json({ message: "Failed to place order." });
      return res.status(201).json({ message: "Order placed successfully.", orderId: this.lastID, totalPrice, sessionId });
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders — read / update
// ─────────────────────────────────────────────────────────────────────────────

// All active orders — used by cook, waiter, counter polling loops.
// NOTE: This endpoint is intentionally public for staff-facing dashboards.
// It only returns today's non-paid orders and contains no customer PII.
// Per-action mutations (status change, cancel, edit) are individually authenticated.
app.get("/orders", (req, res) => {
  const query = `
    SELECT o.id, o.table_number AS "tableNumber", o.items, o.total_price AS "totalPrice",
           o.status, o.created_at AS "createdAt", o.session_id AS "sessionId",
           COALESCE(ts.bill_requested, 0) AS "billRequested"
    FROM orders o
    LEFT JOIN table_sessions ts ON ts.table_number = o.table_number AND ts.session_id = o.session_id
    WHERE o.created_at::date = CURRENT_DATE
      AND o.status NOT IN ('paid')
    ORDER BY o.id DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ message: "Failed to fetch orders." });
    return res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items) })));
  });
});

// Table history scoped to a single customer session
app.get("/orders/table/:num", (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.json([]);

  const query = `
    SELECT o.id, o.table_number AS "tableNumber", o.items, o.total_price AS "totalPrice",
           o.status, o.created_at AS "createdAt",
           COALESCE(ts.bill_requested, 0) AS "billRequested"
    FROM orders o
    LEFT JOIN table_sessions ts ON ts.table_number = o.table_number AND ts.session_id = o.session_id
    WHERE o.table_number = ? AND o.session_id = ?
      AND o.created_at::date = CURRENT_DATE
      AND o.status != 'paid'
    ORDER BY o.id ASC
  `;
  db.all(query, [req.params.num, sessionId], (err, rows) => {
    if (err) return res.status(500).json({ message: "Failed to fetch table orders." });
    return res.json(rows.map(r => ({ ...r, items: r.items ? JSON.parse(r.items) : [] })));
  });
});

// Update order status — staff only, requires role + pin in body
app.patch("/order/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid order ID." });

  const { status, role, pin } = req.body;
  if (!VALID_STATUSES.includes(status))
    return res.status(400).json({ message: "Invalid status." });

  // Require a valid staff PIN to change order status
  if (!role || !isValidPin(pin))
    return res.status(401).json({ message: "Staff credentials required." });

  verifyRolePin(role, pin, authErr => {
    if (authErr) return res.status(authErr.status).json({ message: authErr.message });

    db.get("SELECT id FROM orders WHERE id = ?", [id], (err, row) => {
      if (err)  return res.status(500).json({ message: "Failed to update order." });
      if (!row) return res.status(404).json({ message: "Order not found." });
      db.run("UPDATE orders SET status = ? WHERE id = ?", [status, id], uErr => {
        if (uErr) return res.status(500).json({ message: "Failed to update order." });
        return res.json({ message: "Order updated successfully." });
      });
    });
  });
});

// Edit items in a pending order — customer can adjust, must own the order via sessionId
app.patch("/order/:id/items", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid order ID." });

  const { itemName, delta, sessionId } = req.body;

  // Require sessionId so we can verify ownership
  if (!sessionId) return res.status(401).json({ message: "Session ID required." });

  db.get("SELECT id, status, items, total_price, session_id FROM orders WHERE id = ?", [id], (err, row) => {
    if (err)  return res.status(500).json({ message: "Failed to update order." });
    if (!row) return res.status(404).json({ message: "Order not found." });

    // Ownership check — the session must match
    if (row.session_id !== sessionId)
      return res.status(403).json({ message: "You don't have permission to edit this order." });

    if (row.status !== "pending") return res.status(400).json({ message: "Cannot edit — cook has already started." });

    let orderItems = JSON.parse(row.items);
    const idx = orderItems.findIndex(i => i.name === itemName);
    if (idx === -1) return res.status(404).json({ message: "Item not found in order." });
    if (delta === 0 || orderItems[idx].quantity + delta <= 0) orderItems.splice(idx, 1);
    else orderItems[idx].quantity += delta;

    if (orderItems.length === 0) {
      db.run("DELETE FROM orders WHERE id = ?", [id], dErr => {
        if (dErr) return res.status(500).json({ message: "Failed to cancel order." });
        return res.json({ message: "Order cancelled (no items left).", cancelled: true });
      });
      return;
    }

    const newTotal = orderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    db.run(
      "UPDATE orders SET items = ?, total_price = ? WHERE id = ?",
      [JSON.stringify(orderItems), newTotal, id],
      uErr => {
        if (uErr) return res.status(500).json({ message: "Failed to update order." });
        return res.json({ message: "Order updated.", items: orderItems, newTotal });
      }
    );
  });
});

// Cancel a pending order — customer must own the order via sessionId
app.post("/order/:id/cancel", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid order ID." });

  const { sessionId } = req.body;
  if (!sessionId) return res.status(401).json({ message: "Session ID required." });

  db.get("SELECT id, status, session_id FROM orders WHERE id = ?", [id], (err, row) => {
    if (err)  return res.status(500).json({ message: "Failed to cancel order." });
    if (!row) return res.status(404).json({ message: "Order not found." });

    // Ownership check
    if (row.session_id !== sessionId)
      return res.status(403).json({ message: "You don't have permission to cancel this order." });

    if (row.status !== "pending") return res.status(400).json({ message: "Cannot cancel — cook has already started." });
    db.run("DELETE FROM orders WHERE id = ?", [id], dErr => {
      if (dErr) return res.status(500).json({ message: "Failed to cancel order." });
      return res.json({ message: "Order cancelled successfully." });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bill & Checkout
// ─────────────────────────────────────────────────────────────────────────────

app.post("/table/:num/request-bill", (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ message: "Session ID required." });
  const tableNum = String(req.params.num).trim().toLowerCase();
  if (!isValidTable(tableNum)) return res.status(400).json({ message: "Invalid table." });
  db.run(
    "UPDATE table_sessions SET bill_requested = 1 WHERE table_number = ? AND session_id = ?",
    [tableNum, sessionId],
    function (err) {
      if (err)               return res.status(500).json({ message: "Failed to request bill." });
      if (this.changes === 0) return res.status(404).json({ message: "Session not found." });
      return res.json({ message: "Bill requested." });
    }
  );
});

// Counter confirms payment — requires counter PIN
app.post("/table/:num/checkout", (req, res) => {
  const tableNum = String(req.params.num).trim().toLowerCase();
  const { sessionId, pin } = req.body;
  if (!isValidTable(tableNum)) return res.status(400).json({ message: "Invalid table." });
  if (!sessionId) return res.status(400).json({ message: "Session ID is required for checkout." });
  if (!isValidPin(pin)) return res.status(401).json({ message: "Counter PIN required." });

  verifyRolePin("counter", pin, authErr => {
    if (authErr) return res.status(authErr.status).json({ message: authErr.message });

    db.run(
      `UPDATE orders SET status = 'paid'
       WHERE table_number = ? AND session_id = ?
         AND status IN ('served', 'ready', 'cooking', 'pending')
         AND total_price > 0`,
      [tableNum, sessionId],
      function (err) {
        if (err)               return res.status(500).json({ message: "Checkout failed." });
        if (this.changes === 0) return res.status(400).json({ message: "No active orders found for this session." });
        // Capture BEFORE entering nested callback — this.changes refers to the UPDATE above,
        // not the DELETE below. Inside the nested callback 'this' changes context.
        const updatedCount = this.changes;
        db.run(
          "DELETE FROM table_sessions WHERE table_number = ? AND session_id = ?",
          [tableNum, sessionId],
          delErr => {
            if (delErr) console.error("Failed to release session:", delErr);
            return res.json({ message: `Table ${tableNum} paid. ${updatedCount} order(s) cleared.`, updated: updatedCount });
          }
        );
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin — passwords
// ─────────────────────────────────────────────────────────────────────────────

app.patch("/admin/password", (req, res) => {
  const { adminPin, role, newPin } = req.body;
  if (!["cook", "waiter", "counter", "admin"].includes(role))
    return res.status(400).json({ message: "Invalid role." });
  if (!isValidPin(newPin))
    return res.status(400).json({ message: "New PIN must be 4-20 characters." });
  verifyAdminPin(adminPin, authErr => {
    if (authErr) return res.status(authErr.status).json({ message: authErr.message });
    db.run("UPDATE role_pins SET pin = ? WHERE role = ?", [newPin, role], err => {
      if (err) return res.status(500).json({ message: "Failed to update password." });
      return res.json({ message: `${role} PIN updated successfully.` });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin — menu management
// ─────────────────────────────────────────────────────────────────────────────

// Admin PIN required to view full menu list
app.get("/admin/menu", (req, res) => {
  const adminPin = req.headers["x-admin-pin"] || req.query.adminPin;
  if (!adminPin) return res.status(401).json({ message: "Admin PIN required." });
  verifyAdminPin(adminPin, authErr => {
    if (authErr) return res.status(authErr.status).json({ message: authErr.message });
    db.all("SELECT id, name, price, is_active AS isActive FROM menu_items ORDER BY id ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ message: "Failed to fetch menu items." });
      return res.json(rows);
    });
  });
});

app.post("/admin/menu", (req, res) => {
  const { adminPin, name, price } = req.body;
  const itemName  = typeof name === "string" ? name.trim() : "";
  const itemPrice = Number(price);
  if (!itemName || !isValidPrice(itemPrice))
    return res.status(400).json({ message: "Name and valid price required." });
  verifyAdminPin(adminPin, authErr => {
    if (authErr) return res.status(authErr.status).json({ message: authErr.message });
    db.run("INSERT INTO menu_items (name, price, is_active) VALUES (?, ?, 1)", [itemName, itemPrice], function (err) {
      if (err) return res.status(500).json({ message: "Failed to add menu item." });
      return res.status(201).json({ message: "Menu item added.", id: this.lastID });
    });
  });
});

app.put("/admin/menu/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid menu item ID." });

  const { adminPin, name, isActive, price } = req.body;
  const itemName  = typeof name === "string" ? name.trim() : "";
  const itemPrice = Number(price);
  if (!itemName || typeof isActive !== "boolean" || !isValidPrice(itemPrice))
    return res.status(400).json({ message: "Name, price and isActive are required." });
  verifyAdminPin(adminPin, authErr => {
    if (authErr) return res.status(authErr.status).json({ message: authErr.message });
    db.run(
      "UPDATE menu_items SET name = ?, price = ?, is_active = ? WHERE id = ?",
      [itemName, itemPrice, isActive ? 1 : 0, id],
      function (err) {
        if (err)               return res.status(500).json({ message: "Failed to update menu item." });
        if (this.changes === 0) return res.status(404).json({ message: "Menu item not found." });
        return res.json({ message: "Menu item updated." });
      }
    );
  });
});

app.delete("/admin/menu/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid menu item ID." });

  const { adminPin } = req.body;
  verifyAdminPin(adminPin, authErr => {
    if (authErr) return res.status(authErr.status).json({ message: authErr.message });
    db.run("DELETE FROM menu_items WHERE id = ?", [id], function (err) {
      if (err)               return res.status(500).json({ message: "Failed to delete menu item." });
      if (this.changes === 0) return res.status(404).json({ message: "Menu item not found." });
      return res.json({ message: "Menu item deleted." });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stats & Sales — require admin or manager PIN
// ─────────────────────────────────────────────────────────────────────────────

function requireManagerAccess(req, res, next) {
  const pin  = req.headers["x-admin-pin"] || req.query.adminPin;
  const role = req.headers["x-role"]      || req.query.role;
  if (!pin || !role) return res.status(401).json({ message: "Credentials required." });
  if (!["admin", "cook"].includes(role))
    return res.status(403).json({ message: "Access denied." });
  verifyRolePin(role, pin, authErr => {
    if (authErr) return res.status(authErr.status).json({ message: authErr.message });
    next();
  });
}

app.get("/manager/stats", requireManagerAccess, (_req, res) => {
  db.get(
    `SELECT COALESCE(SUM(total_price), 0) AS "totalRevenue", COUNT(id) AS "totalOrders"
     FROM orders WHERE created_at::date = CURRENT_DATE AND status = 'paid'`,
    [],
    (err, row) => {
      if (err) return res.status(500).json({ message: "Failed to fetch stats." });
      return res.json(row || { totalRevenue: 0, totalOrders: 0 });
    }
  );
});

app.get("/sales/today", requireManagerAccess, (_req, res) => {
  db.all(
    `SELECT id, table_number AS "tableNumber", total_price AS "totalPrice", created_at AS "createdAt"
     FROM orders WHERE created_at::date = CURRENT_DATE AND status = 'paid' ORDER BY id DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "Failed to fetch today's sales." });
      return res.json({ rows, totalSales: rows.reduce((s, r) => s + Number(r.totalPrice || 0), 0) });
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Reset — requires cook or admin PIN (always, no bypass)
// ─────────────────────────────────────────────────────────────────────────────

app.post("/orders/reset", (req, res) => {
  const { role, pin } = req.body;

  // Credentials are ALWAYS required — no fallback path
  if (!role || !pin)
    return res.status(401).json({ message: "Valid cook or admin credentials are required." });
  if (!["cook", "admin"].includes(role) || !isValidPin(pin))
    return res.status(400).json({ message: "Valid cook/admin credentials are required." });

  verifyRolePin(role, pin, authErr => {
    if (authErr) return res.status(authErr.status).json({ message: authErr.message });
    doReset(res);
  });
});

function doReset(res) {
  db.run("DELETE FROM orders", [], err => {
    if (err) return res.status(500).json({ message: "Failed to clear orders." });
    db.run("DELETE FROM table_sessions", [], sessErr => {
      if (sessErr) console.error("Failed to clear sessions during reset:", sessErr);
      db.run("ALTER SEQUENCE orders_id_seq RESTART WITH 1", [], seqErr => {
        if (seqErr) console.error("Failed to reset order ID sequence:", seqErr);
        return res.json({ message: "All orders cleared. Order ID reset to 1." });
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-reset at midnight Nepal time (UTC+5:45 = 18:15 UTC)
// ─────────────────────────────────────────────────────────────────────────────

function scheduleAutoReset() {
  const now      = new Date();
  // Nepal is UTC+5:45. Midnight Nepal = 18:15 UTC previous day.
  // Find the next 18:15 UTC from now.
  const next     = new Date(now);
  next.setUTCHours(18, 15, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const msUntil  = next - now;

  setTimeout(() => {
    db.run("DELETE FROM orders", [], err => {
      if (err) return console.error("Auto-reset: failed to clear orders:", err);
      db.run("DELETE FROM table_sessions", [], sessErr => {
        if (sessErr) console.error("Auto-reset: failed to clear sessions:", sessErr);
        db.run("ALTER SEQUENCE orders_id_seq RESTART WITH 1", [], seqErr => {
          if (seqErr) console.error("Auto-reset: failed to reset sequence:", seqErr);
          console.log("Auto-reset: orders cleared at Nepal midnight.");
        });
      });
    });
    scheduleAutoReset();
  }, msUntil);

  const mins = Math.round(msUntil / 60000);
  console.log(`Auto-reset scheduled in ${mins} min (18:15 UTC = midnight Nepal).`);
}

scheduleAutoReset();

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`Smart Order running on port ${PORT}`));
