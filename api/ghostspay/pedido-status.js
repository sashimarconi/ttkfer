const {
  ghostspayRequest,
  legacyApiRequest,
  hasGhostspayCredentials,
  findFirstByKeys,
  normalizePaymentStatus,
  toInteger,
} = require("./lib/ghostspay");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const transactionId = req.query?.transaction_id || req.query?.id;
  if (!transactionId) {
    return res.status(400).json({ success: false, error: "transaction_id is required" });
  }

  try {
    if (!hasGhostspayCredentials()) {
      const legacy = await legacyApiRequest(`/pedido/status?transaction_id=${encodeURIComponent(String(transactionId))}`);
      return res.status(200).json(legacy);
    }

    const details = await ghostspayRequest(`/transactions/${encodeURIComponent(String(transactionId))}`);

    const id = findFirstByKeys(details, ["id", "transaction_id", "transactionId", "payment_id"]) || transactionId;
    const statusRaw = findFirstByKeys(details, ["status", "payment_status", "transaction_status"]);
    const amount = findFirstByKeys(details, ["amount", "value", "total"]);
    const createdAt = findFirstByKeys(details, ["created_at", "createdAt", "date_created"]);
    const updatedAt = findFirstByKeys(details, ["updated_at", "updatedAt", "date_updated"]);

    return res.status(200).json({
      success: true,
      transaction: {
        transaction_id: String(id),
        status: normalizePaymentStatus(statusRaw),
        amount: toInteger(amount, 0),
        created_at: createdAt || null,
        updated_at: updatedAt || null,
      },
      raw_status: statusRaw || null,
    });
  } catch (error) {
    const statusCode = error.statusCode && Number.isInteger(error.statusCode)
      ? error.statusCode
      : 500;

    return res.status(statusCode).json({
      success: false,
      error: error.message || "Failed to fetch status",
      details: error.details || null,
    });
  }
};
