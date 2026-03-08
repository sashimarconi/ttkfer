const {
  ghostspayRequest,
  legacyApiRequest,
  hasGhostspayCredentials,
  findFirstByKeys,
  normalizePaymentStatus,
  toInteger,
  mapItems,
} = require("./lib/ghostspay");

function convertStatusToPedido(status) {
  if (status === "paid") {
    return "pago";
  }
  if (status === "expired") {
    return "expirado";
  }
  return "pendente";
}

function centsToReais(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }

  // GhostsPay typically returns integer values in cents.
  if (Number.isInteger(n)) {
    return n / 100;
  }

  return n;
}

function parseCurrencyToReais(value) {
  if (typeof value === "number") {
    return value;
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
  return Number.isFinite(n) ? n : 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const id = req.query?.id;
  if (!id) {
    return res.status(400).json({ success: false, error: "id is required" });
  }

  try {
    if (!hasGhostspayCredentials()) {
      const legacy = await legacyApiRequest(`/db/pedidos/${encodeURIComponent(String(id))}`);
      return res.status(200).json(legacy);
    }

    const details = await ghostspayRequest(`/transactions/${encodeURIComponent(String(id))}`);

    const metadata = findFirstByKeys(details, ["metadata"]) || {};
    const customer = findFirstByKeys(details, ["customer"]) || {};
    const itemsFromMetadata = metadata?.pedido_data?.itens || metadata?.order_data?.items || [];
    const items = mapItems(itemsFromMetadata);

    const transactionId = findFirstByKeys(details, ["id", "transaction_id", "transactionId", "payment_id"]) || id;
    const rawStatus = findFirstByKeys(details, ["status", "payment_status", "transaction_status"]);
    const normalizedStatus = normalizePaymentStatus(rawStatus);

    const amountRaw = findFirstByKeys(details, ["amount", "value", "total"]);
    const amountFromGateway = centsToReais(amountRaw);
    const amountFromMetadata = parseCurrencyToReais(metadata?.pedido_data?.total || metadata?.order_data?.amount);
    const amount = amountFromMetadata > 0 ? amountFromMetadata : amountFromGateway;

    const subtotal = parseCurrencyToReais(metadata?.pedido_data?.subtotal);
    const desconto = parseCurrencyToReais(metadata?.pedido_data?.desconto);

    const pixCode = findFirstByKeys(details, [
      "pix_code",
      "pixCode",
      "qr_code",
      "qrCode",
      "copy_paste",
      "copyAndPaste",
      "emv",
      "chavepix",
    ]) || "";

    const pixQrBase64 = findFirstByKeys(details, [
      "pix_qr_code_base64",
      "qr_code_base64",
      "qrCodeBase64",
      "base64",
    ]);

    const response = {
      id: String(transactionId),
      order_id: String(transactionId),
      cliente_nome: customer?.name || metadata?.customer_data?.nome || "",
      cliente_email: customer?.email || metadata?.customer_data?.email || "",
      cliente_telefone: customer?.phone || metadata?.customer_data?.telefone || "",
      cliente_cpf: customer?.document || metadata?.customer_data?.cpf || "",
      cliente_endereco: metadata?.pedido_data?.cliente_endereco || null,
      endereco_entrega: metadata?.pedido_data?.endereco_entrega || null,
      numero_entrega: metadata?.pedido_data?.numero_entrega || null,
      complemento_entrega: metadata?.pedido_data?.complemento_entrega || null,
      bairro_entrega: metadata?.pedido_data?.bairro_entrega || null,
      cidade_entrega: metadata?.pedido_data?.cidade_entrega || null,
      estado_entrega: metadata?.pedido_data?.estado_entrega || null,
      cep_entrega: metadata?.pedido_data?.cep_entrega || null,
      itens: items,
      total: amount,
      desconto: desconto,
      subtotal: subtotal > 0 ? subtotal : amount,
      status: convertStatusToPedido(normalizedStatus),
      status_pagamento: normalizedStatus,
      status_entrega: null,
      status_taxas: null,
      historico_rastreamento: null,
      pix_qr_code: null,
      pix_qr_code_base64: pixQrBase64 || null,
      pix_copia_cola: pixCode,
      pix_expiracao: null,
      pix_payment_id: String(transactionId),
      pix_code: pixCode,
      pix_qrcode: pixCode,
      beehive_transaction_id: null,
      fenix_transaction_id: null,
      payment_method: "pix",
      installments: 1,
      data_criacao: findFirstByKeys(details, ["created_at", "createdAt", "date_created"]) || null,
      data_atualizacao: findFirstByKeys(details, ["updated_at", "updatedAt", "date_updated"]) || null,
      data_pagamento: normalizedStatus === "paid"
        ? (findFirstByKeys(details, ["paid_at", "paidAt", "approved_at", "approvedAt"]) || null)
        : null,
      usuario_id: metadata?.pedido_data?.usuario_id || null,
    };

    return res.status(200).json(response);
  } catch (error) {
    const statusCode = error.statusCode && Number.isInteger(error.statusCode)
      ? error.statusCode
      : 500;

    return res.status(statusCode).json({
      error: true,
      success: false,
      message: error.message || "Failed to fetch pedido",
      details: error.details || null,
    });
  }
};
