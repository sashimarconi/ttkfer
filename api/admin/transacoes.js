const {
  ghostspayRequest,
  hasGhostspayCredentials,
  findFirstByKeys,
  normalizePaymentStatus,
  toInteger,
} = require("../ghostspay/lib/ghostspay");

function getTokenFromRequest(req) {
  const header = req.headers["authorization"] || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  if (req.headers["x-admin-token"]) {
    return String(req.headers["x-admin-token"]).trim();
  }
  if (req.query && req.query.token) {
    return String(req.query.token).trim();
  }
  return "";
}

function isAuthorized(req) {
  const expected = process.env.ADMIN_PANEL_TOKEN;
  if (!expected) {
    return false;
  }
  return getTokenFromRequest(req) === expected;
}

function normalizeList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.transactions)) {
    return payload.transactions;
  }
  if (Array.isArray(payload?.results)) {
    return payload.results;
  }
  return [];
}

function mapTransaction(item) {
  const id = findFirstByKeys(item, ["id", "transaction_id", "transactionId", "payment_id"]);
  const externalRef = findFirstByKeys(item, ["externalRef", "external_ref", "order_id", "orderId"]);
  const rawStatus = findFirstByKeys(item, ["status", "payment_status", "transaction_status"]);
  const amount = findFirstByKeys(item, ["amount", "value", "total"]);
  const createdAt = findFirstByKeys(item, ["created_at", "createdAt", "date_created"]);
  const customer = findFirstByKeys(item, ["customer"]) || {};
  const pixCode = findFirstByKeys(item, ["pix_code", "pixCode", "qr_code", "qrCode", "copy_paste", "copyAndPaste"]);

  return {
    transaction_id: id ? String(id) : null,
    order_id: externalRef ? String(externalRef) : null,
    status: normalizePaymentStatus(rawStatus),
    raw_status: rawStatus || null,
    amount: toInteger(amount, 0),
    created_at: createdAt || null,
    customer_name: customer?.name || null,
    customer_email: customer?.email || null,
    customer_phone: customer?.phone || null,
    pix_code: pixCode ? String(pixCode) : null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  if (!process.env.ADMIN_PANEL_TOKEN) {
    return res.status(500).json({
      success: false,
      error: "ADMIN_PANEL_TOKEN is not configured",
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  if (!hasGhostspayCredentials()) {
    return res.status(400).json({
      success: false,
      error: "GhostsPay credentials not configured",
    });
  }

  const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 30)));
  const page = Math.max(1, Number(req.query?.page || 1));

  try {
    const payload = await ghostspayRequest(`/transactions?page=${page}&limit=${limit}`);
    const list = normalizeList(payload).map(mapTransaction).filter((tx) => tx.transaction_id);

    return res.status(200).json({
      success: true,
      page,
      limit,
      count: list.length,
      data: list,
    });
  } catch (error) {
    const statusCode = error.statusCode && Number.isInteger(error.statusCode)
      ? error.statusCode
      : 500;

    return res.status(statusCode).json({
      success: false,
      error: error.message || "Failed to fetch transactions",
      details: error.details || null,
    });
  }
};
