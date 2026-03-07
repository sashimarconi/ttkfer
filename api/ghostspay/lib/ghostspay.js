const DEFAULT_BASE_URL = "https://api.ghostspaysv2.com/functions/v1";

function getBaseUrl() {
  return (process.env.GHOSTSPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function hasGhostspayCredentials() {
  return Boolean(process.env.GHOSTSPAY_SECRET_KEY && process.env.GHOSTSPAY_COMPANY_ID);
}

function buildAuthHeader() {
  const secretKey = process.env.GHOSTSPAY_SECRET_KEY;
  const companyId = process.env.GHOSTSPAY_COMPANY_ID;

  if (!secretKey || !companyId) {
    const error = new Error("Missing GhostsPay credentials");
    error.statusCode = 500;
    throw error;
  }

  const credentials = Buffer.from(`${secretKey}:${companyId}`).toString("base64");
  return `Basic ${credentials}`;
}

async function ghostspayRequest(path, options = {}) {
  const { method = "GET", body } = options;
  const headers = {
    Accept: "application/json",
    Authorization: buildAuthHeader(),
  };

  const requestOptions = {
    method,
    headers,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(body);
  }

  const response = await fetch(`${getBaseUrl()}${path}`, requestOptions);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error("GhostsPay request failed");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function legacyApiRequest(path, options = {}) {
  const { method = "GET", body } = options;
  const headers = {
    Accept: "application/json",
  };

  const requestOptions = {
    method,
    headers,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(body);
  }

  const response = await fetch(`https://famosinhosoficial.com/api${path}`, requestOptions);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error("Legacy API request failed");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function flattenValues(value, list = []) {
  if (value === null || value === undefined) {
    return list;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      flattenValues(item, list);
    }
    return list;
  }

  if (typeof value === "object") {
    list.push(value);
    for (const child of Object.values(value)) {
      flattenValues(child, list);
    }
  }

  return list;
}

function findFirstByKeys(payload, keys) {
  const normalized = new Set(keys.map((k) => k.toLowerCase()));
  const nodes = flattenValues(payload, []);

  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (normalized.has(key.toLowerCase()) && value !== null && value !== undefined && value !== "") {
        return value;
      }
    }
  }

  return null;
}

function normalizePaymentStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["paid", "approved", "succeeded", "success", "completed"].includes(value)) {
    return "paid";
  }
  if (["expired", "canceled", "cancelled", "failed", "refused", "rejected", "voided"].includes(value)) {
    return "expired";
  }
  return "pending";
}

function toInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function mapItems(rawItems) {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .map((item) => ({
      nome: item?.nome || item?.name || item?.title || "Item",
      preco: toInteger(item?.preco ?? item?.unitPrice ?? item?.price, 0),
      quantidade: toInteger(item?.quantidade ?? item?.quantity, 1),
      imagem: item?.imagem || item?.image || null,
    }))
    .filter((item) => item.preco > 0 && item.quantidade > 0);
}

module.exports = {
  ghostspayRequest,
  legacyApiRequest,
  hasGhostspayCredentials,
  findFirstByKeys,
  normalizePaymentStatus,
  toInteger,
  mapItems,
};
