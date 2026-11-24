import { configuredOrigin, emailOf, enabled, fail, field, query } from "./core.mjs";
import { realMailEnabled } from "./email.mjs";

const title = "RouterOS pas cu pas";
const availabilityOptions = new Set(["coming_soon", "preorder", "available", "sold_out"]);

const catalogDefaults = {
  title,
  edition: "Print edition",
  description: "Learn MikroTik RouterOS one configuration at a time, with practical explanations and labs you can follow at your own pace.",
  bookLanguage: "Romanian",
  coverUrl: "",
  currency: "RON",
  regularPriceMinor: 34900,
  preorderPriceMinor: 24900,
  deliveryMinor: 2600,
  offerStartsAt: null,
  offerEndsAt: null,
  availability: "preorder",
  offerApproved: false,
  contactEmail: "office@academia-mikrotik.ro",
};
const romanianCatalog = {
  edition: "Ediție tipărită",
  description: "Învață MikroTik RouterOS pas cu pas, cu explicații practice și laboratoare pe care le poți parcurge în ritmul tău.",
  bookLanguage: "Română",
};
const contentDefaults = {
  about: "", seller: "Educat IT", privacy: "", terms: "", delivery: "", returns: "",
  chapters: [], gallery: [], testimonials: [], partners: [], sponsors: [], faq: [],
};
const blankTranslation = { ...contentDefaults, seller: "" };

const collections = {
  chapters: { title: 180, description: 2000, href: "url" },
  gallery: { title: 160, src: "url", alt: 300, caption: 500 },
  testimonials: { quote: 2000, name: 160, role: 200 },
  partners: { name: 160, contribution: 1500, logo: "url", url: "url" },
  sponsors: { name: 160, contribution: 1500, logo: "url", url: "url" },
  faq: { question: 240, answer: 3000 },
};
const requiredFields = {
  chapters: ["title"],
  gallery: ["title", "src", "alt"],
  testimonials: ["quote", "name"],
  partners: ["name", "contribution"],
  sponsors: ["name", "contribution"],
  faq: ["question", "answer"],
};

function minorValue(value, name) {
  if (value === undefined || value === null || value === "") return null;
  if (!Number.isInteger(value) || value < 0 || value > 10_000_000) {
    fail(400, name + " must be an integer amount in bani.", "invalid_price");
  }
  return value;
}

function dateValue(value, name) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    fail(400, name + " must be a valid date.", "invalid_date");
  }
  return new Date(value).toISOString();
}

function link(value, name) {
  const raw = field(value, 1500, name);
  if (!raw) return "";
  if (/^\/(?![\/\\])[^\s\\]*$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    // Invalid URLs are handled below.
  }
  fail(400, name + " must be an HTTPS URL or a local path.", "invalid_url");
}

function translations(catalog, fallback) {
  return {
    edition: field(catalog.edition ?? fallback.edition, 160, "Edition"),
    description: field(catalog.description ?? fallback.description, 3000, "Description"),
    bookLanguage: field(catalog.bookLanguage ?? fallback.bookLanguage, 80, "Book language"),
  };
}

function cleanContent(input = {}, fallback = contentDefaults) {
  const clean = {};
  for (const key of ["about", "seller", "privacy", "terms", "delivery", "returns"]) {
    clean[key] = field(input[key] ?? fallback[key], 12_000, key);
  }
  for (const [name, fields] of Object.entries(collections)) {
    const list = input[name] ?? fallback[name];
    if (!Array.isArray(list) || list.length > 50) {
      fail(400, name + " must contain at most 50 entries.", "invalid_content");
    }
    clean[name] = list.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        fail(400, name + " entries must be objects.", "invalid_content");
      }
      const row = { approved: item.approved === true };
      for (const [key, limit] of Object.entries(fields)) {
        row[key] = limit === "url" ? link(item[key], key) : field(item[key], limit, key);
        if (row.approved && requiredFields[name].includes(key) && !row[key]) {
          fail(400, name + " requires " + key + " before publication.", "incomplete_content");
        }
      }
      return row;
    });
  }
  return clean;
}

export function cleanSettings(input) {
  const source = input.catalog ?? {};
  const catalog = {
    ...catalogDefaults,
    ...translations(source, catalogDefaults),
    coverUrl: link(source.coverUrl, "Cover image"),
    contactEmail: emailOf(source.contactEmail ?? catalogDefaults.contactEmail, false),
    regularPriceMinor: minorValue(Object.hasOwn(source, "regularPriceMinor") ? source.regularPriceMinor : catalogDefaults.regularPriceMinor, "Regular price"),
    preorderPriceMinor: minorValue(Object.hasOwn(source, "preorderPriceMinor") ? source.preorderPriceMinor : catalogDefaults.preorderPriceMinor, "Preorder price"),
    deliveryMinor: minorValue(Object.hasOwn(source, "deliveryMinor") ? source.deliveryMinor : catalogDefaults.deliveryMinor, "Delivery charge"),
    offerStartsAt: dateValue(source.offerStartsAt, "Offer start"),
    offerEndsAt: dateValue(source.offerEndsAt, "Offer end"),
    availability: source.availability ?? catalogDefaults.availability,
    offerApproved: source.offerApproved === true,
    translations: { ro: translations(source.translations?.ro ?? {}, romanianCatalog) },
  };

  if (!availabilityOptions.has(catalog.availability)) {
    fail(400, "Choose a supported availability state.", "invalid_availability");
  }
  if (catalog.offerStartsAt && catalog.offerEndsAt && catalog.offerStartsAt >= catalog.offerEndsAt) {
    fail(400, "The offer end must be later than the start.", "invalid_offer_period");
  }
  if (catalog.regularPriceMinor !== null && catalog.preorderPriceMinor !== null &&
      catalog.preorderPriceMinor >= catalog.regularPriceMinor) {
    fail(400, "Preorder price must be below regular price.", "invalid_discount");
  }

  const content = cleanContent(input.content);
  content.translations = {
    ro: cleanContent(input.content?.translations?.ro, blankTranslation),
  };
  return { catalog, content };
}

export async function getSettings(db) {
  const row = await query(db, "SELECT body FROM store_settings WHERE id = 1").first();
  return row ? cleanSettings(JSON.parse(row.body)) : cleanSettings({});
}

export function stripeMode(env) {
  const mode = env.STRIPE_MODE;
  if (mode !== "live" && mode !== "test") return null;
  if (!new RegExp("^(sk|rk)_" + mode + "_").test(env.STRIPE_SECRET_KEY ?? "")) return null;
  if (!/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET ?? "")) return null;
  if (mode === "live" && !configuredOrigin(env)) return null;
  return "stripe_" + mode;
}

export function demoEnabled(env) {
  return enabled(env.DEMO_MODE) && env.STRIPE_MODE !== "live";
}

function configuredAvailability(catalog, now) {
  if (catalog.availability === "sold_out") return "sold_out";
  if (!catalog.regularPriceMinor || catalog.deliveryMinor === null) return "coming_soon";
  if (catalog.availability === "available") return "available";
  if (catalog.availability === "preorder" && catalog.preorderPriceMinor > 0 &&
      (!catalog.offerStartsAt || Date.parse(catalog.offerStartsAt) <= now) &&
      (!catalog.offerEndsAt || Date.parse(catalog.offerEndsAt) > now)) {
    return "preorder";
  }
  return "coming_soon";
}

function approvedAvailability(settings, env, now) {
  const { catalog, content } = settings;
  if (catalog.availability === "sold_out") return "sold_out";
  const requiredPages = ["seller", "terms", "privacy", "delivery", "returns"];
  const hasPolicies = requiredPages.every(key => content[key] && content.translations.ro[key]);
  if (stripeMode(env) !== "stripe_live" || !realMailEnabled(env) || !catalog.offerApproved ||
      !catalog.coverUrl || !hasPolicies) {
    return "coming_soon";
  }
  return configuredAvailability(catalog, now);
}

export function publicCatalog(settings, env, locale, now = Date.now()) {
  const { translations, ...base } = settings.catalog;
  const displayed = { ...base, ...(locale === "ro" ? translations.ro : {}) };
  const availability = approvedAvailability(settings, env, now);
  const open = availability === "preorder" || availability === "available";
  return {
    ...displayed,
    availability,
    checkoutMode: open ? "stripe_live" : "closed",
    regularPriceMinor: open ? displayed.regularPriceMinor : null,
    preorderPriceMinor: availability === "preorder" ? displayed.preorderPriceMinor : null,
    deliveryMinor: open ? displayed.deliveryMinor : null,
    offerStartsAt: open ? displayed.offerStartsAt : null,
    offerEndsAt: open ? displayed.offerEndsAt : null,
  };
}

export function getDemoCatalog(settings, env, locale) {
  if (!demoEnabled(env)) return null;
  const base = publicCatalog(settings, env, locale);
  const { catalog } = settings;
  const availability = configuredAvailability(catalog, Date.now());
  const open = availability === "preorder" || availability === "available";
  return {
    ...base,
    regularPriceMinor: open ? catalog.regularPriceMinor : null,
    preorderPriceMinor: availability === "preorder" ? catalog.preorderPriceMinor : null,
    deliveryMinor: open ? catalog.deliveryMinor : null,
    offerStartsAt: availability === "preorder" ? catalog.offerStartsAt : null,
    offerEndsAt: availability === "preorder" ? catalog.offerEndsAt : null,
    availability,
    checkoutMode: open ? stripeMode(env) === "stripe_test" ? "stripe_test" : "demo" : "closed",
  };
}

export function publicContent(settings, locale) {
  const { translations, ...english } = settings.content;
  const content = locale === "ro" ? { ...translations.ro } : english;
  content.seller ||= contentDefaults.seller;
  for (const key of Object.keys(collections)) {
    content[key] = content[key].filter((row) => row.approved);
  }
  return content;
}

export function calculateQuote(catalog, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 25) {
    fail(400, "Choose between 1 and 25 books.", "invalid_quantity");
  }
  if (!catalog || catalog.checkoutMode === "closed") {
    fail(409, "Preorders are opening soon.", "checkout_closed");
  }
  const unitPriceMinor = catalog.availability === "preorder"
    ? catalog.preorderPriceMinor
    : catalog.regularPriceMinor;
  const subtotalMinor = unitPriceMinor * quantity;
  const savingsMinor = (catalog.regularPriceMinor - unitPriceMinor) * quantity;
  return {
    quantity,
    unitPriceMinor,
    regularPriceMinor: catalog.regularPriceMinor,
    subtotalMinor,
    deliveryMinor: catalog.deliveryMinor,
    totalMinor: subtotalMinor + catalog.deliveryMinor,
    savingsMinor,
    currency: "RON",
    mode: catalog.checkoutMode,
  };
}
