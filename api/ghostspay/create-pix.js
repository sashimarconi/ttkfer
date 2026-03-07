const {
  ghostspayRequest,
  legacyApiRequest,
  hasGhostspayCredentials,
  findFirstByKeys,
  toInteger,
} = require("./lib/ghostspay");

function parseBody(req) {
  if (!req.body) {
    return {};
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function parseCurrencyToCents(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    // If value already looks like cents (e.g. 9490), keep it.
    if (value >= 100 && Number.isInteger(value)) {
      return value;
    }
    return Math.round(value * 100);
  }

  if (typeof value !== "string") {
    return 0;
  }

  const cleaned = value.replace(/[^0-9,.-]/g, "").trim();
  if (!cleaned) {
    return 0;
  }

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;

  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    return 0;
  }

  if (n >= 100 && Number.isInteger(n)) {
    return n;
  }

  return Math.round(n * 100);
}

function buildGhostspayPayload(input) {
  const customerData = input.customer_data || {};
  const orderData = input.order_data || {};
  const pedidoData = input.pedido_data || {};
  const sourceItems = Array.isArray(orderData.items)
    ? orderData.items
    : Array.isArray(pedidoData.itens)
      ? pedidoData.itens
      : [];

  const items = sourceItems.map((item) => ({
    title: item?.nome || item?.name || "Item",
    unitPrice: parseCurrencyToCents(item?.preco ?? item?.unitPrice ?? item?.price),
    quantity: toInteger(item?.quantidade ?? item?.quantity, 1),
    externalRef: item?.sku || item?.externalRef || undefined,
  })).filter((item) => item.unitPrice > 0 && item.quantity > 0);

  const itemsAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const amountCandidates = [
    orderData.amount,
    pedidoData.total,
    pedidoData.subtotal,
    input.amount,
  ];

  let amount = 0;
  for (const candidate of amountCandidates) {
    amount = parseCurrencyToCents(candidate);
    if (amount > 0) {
      break;
    }
  }
  if (amount <= 0) {
    amount = itemsAmount;
  }

  const finalAmount = Math.max(100, amount);

  return {
    customer: {
      name: customerData.nome || customerData.name || "Cliente",
      email: customerData.email || "",
      phone: customerData.telefone || customerData.phone || "",
      document: customerData.cpf || customerData.document || "",
    },
    paymentMethod: "PIX",
    pix: {
      expiresInDays: 1,
    },
    amount: finalAmount,
    items: items.length > 0 ? items : undefined,
    description: orderData.product_name || input.description || "Pagamento PIX",
    externalRef: orderData.order_id || `ORDER_${Date.now()}`,
    postbackUrl: process.env.GHOSTSPAY_WEBHOOK_URL || undefined,
    metadata: {
      source: "ttkfer",
      customer_data: customerData,
      order_data: orderData,
      pedido_data: pedidoData,
      tracking_data: input.tracking_data || {},
    },
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const input = parseBody(req);

    if (!hasGhostspayCredentials()) {
      const legacy = await legacyApiRequest("/create-pix", { method: "POST", body: input });
      return res.status(201).json(legacy);
    }

    const payload = buildGhostspayPayload(input);
    let created;
    try {
      created = await ghostspayRequest("/transactions", { method: "POST", body: payload });
    } catch (ghostError) {
      // Fallback keeps checkout working if GhostsPay rejects a particular payload.
      if (ghostError.statusCode === 400 || ghostError.statusCode === 422) {
        const legacy = await legacyApiRequest("/create-pix", { method: "POST", body: input });
        res.setHeader("x-gateway-fallback", "legacy");
        return res.status(201).json(legacy);
      }
      throw ghostError;
    }

    const transactionId = findFirstByKeys(created, [
      "id",
      "transaction_id",
      "transactionId",
      "payment_id",
      "pix_payment_id",
    ]);

    const pixCode = findFirstByKeys(created, [
      "pix_code",
      "pixCode",
      "qr_code",
      "qrCode",
      "copy_paste",
      "copyAndPaste",
      "emv",
      "chavepix",
    ]);

    const pixQrBase64 = findFirstByKeys(created, [
      "pix_qr_code_base64",
      "qr_code_base64",
      "qrCodeBase64",
      "base64",
    ]);

    if (!transactionId || !pixCode) {
      return res.status(502).json({
        success: false,
        error: "Invalid GhostsPay response",
        details: created,
      });
    }

    return res.status(201).json({
      success: true,
      transaction_id: String(transactionId),
      order_id: String(transactionId),
      chavepix: String(pixCode),
      qr_code: String(pixCode),
      pix_qrcode: String(pixCode),
      pix_qr_code_base64: pixQrBase64 || null,
      amount: payload.amount,
    });
  } catch (error) {
    const statusCode = error.statusCode && Number.isInteger(error.statusCode)
      ? error.statusCode
      : 500;

    return res.status(statusCode).json({
      success: false,
      error: error.message || "Failed to create PIX",
      details: error.details || null,
    });
  }
};
