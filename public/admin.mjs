import {
  action, api, button, checkbox, description, english, esc, field, formMessage, formStatus, handleForm,
  localDate, money, notice, pageHeading, params, path, post, section, selectField, t,
} from "./ui.mjs";

const bilingual = (ro, en) => english ? en : ro;
const languageLabels = { ro: "Română", en: "English" };
const catalogFields = ["edition", "description", "bookLanguage"];
const texts = ["about", "seller", "privacy", "terms", "delivery", "returns"];
const columns = {
  chapters: { title: "title", description: "description", href: "url" },
  gallery: { title: "title", src: "url", alt: "alt", caption: "caption" },
  testimonials: { quote: "quote", name: "name", role: "role" },
  partners: { name: "name", contribution: "contribution", logo: "logo", url: "url" },
  sponsors: { name: "name", contribution: "contribution", logo: "logo", url: "url" },
  faq: { question: "question", answer: "answer" },
};
const aliases = { chapters: "contents" };
const labels = {
  title: ["Titlu", "Title"], description: ["Descriere", "Description"], url: ["Adresă HTTPS sau cale locală", "HTTPS URL or local path"],
  alt: ["Descriere alternativă a imaginii", "Image alternative text"], caption: ["Legendă", "Caption"],
  quote: ["Textul recenziei", "Review text"], name: ["Nume", "Name"], role: ["Rol / organizație", "Role / organisation"],
  contribution: ["Contribuție", "Contribution"], logo: ["Adresa siglei", "Logo URL"], question: ["Întrebare", "Question"],
  answer: ["Răspuns", "Answer"], edition: ["Ediție", "Edition"], bookLanguage: ["Limba cărții", "Book language"],
  seller: ["Datele comerciantului", "Seller details"],
};
const label = (key) => labels[key] ? bilingual(...labels[key]) : t(key);
const statuses = ["unfulfilled", "preparing", "shipped", "delivered", "cancelled"];
const paymentLabels = { pending: "transactionPending", paid: "paid", failed: "failed", cancelled: "cancelled" };
const allowedMoves = {
  unfulfilled: ["preparing", "shipped", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};
let revision = 0;
let collectionSequence = 0;

function minorToRon(amount) {
  return amount === null ? "" : (amount / 100).toFixed(2);
}

function dateToLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function settingsForm({ settings }) {
  const { catalog, content } = settings;
  const availability = ["coming_soon", "preorder", "available", "sold_out"];
  const localizedStates = ["comingSoon", "preorder", "available", "soldOut"];
  const minorFields = [
    ["regularPriceMinor", t("regular")], ["preorderPriceMinor", t("promo")], ["deliveryMinor", t("deliveryRomania")],
  ];
  return '<form id="admin-settings" class="admin-pane stack" method="post"><div class="card stack"><h2>' + t("pricing") + '</h2>' +
    '<div class="form-grid">' + minorFields.map(([key, name]) => field(key, name + " (RON)", {
      type: "number", attrs: 'min="0" max="100000" step="0.01"', value: minorToRon(catalog[key]),
    })).join("") +
    selectField("availability", bilingual("Disponibilitate", "Availability"),
      availability.map((key, i) => [key, t(localizedStates[i])]), catalog.availability) +
    field("offerStartsAt", bilingual("Activare ofertă, ora locală", "Offer opens, local time"),
      { type: "datetime-local", value: dateToLocal(catalog.offerStartsAt) }) +
    field("offerEndsAt", bilingual("Încheiere ofertă, ora locală", "Offer ends, local time"),
      { type: "datetime-local", value: dateToLocal(catalog.offerEndsAt) }) +
    field("coverUrl", bilingual("Adresă copertă aprobată", "Approved cover URL"),
      { value: catalog.coverUrl, attrs: 'maxlength="1500"' }) +
    field("contactEmail", t("emailAddress"), { type: "email", value: catalog.contactEmail, attrs: 'maxlength="254"' }) +
    '</div>' + checkbox("offerApproved", bilingual("Aprob condițiile de vânzare afișate", "Approve the stated sales terms"),
      catalog.offerApproved ? "checked" : "") + '</div>' +
    ["ro", "en"].map(lang => languageSettings(lang, catalog, content)).join("") +
    '<div class="action-row">' + button(t("save"), 'type="submit"') + formStatus + '</div></form>';
}

function languageSettings(lang, catalog, content) {
  const translation = lang === "ro" ? catalog.translations.ro : catalog;
  const pages = lang === "ro" ? content.translations.ro : content;
  return '<details' + (lang === (english ? "en" : "ro") ? " open" : "") +
    '><summary>' + languageLabels[lang] + '</summary><div class="stack"><div class="form-grid">' +
    catalogFields.map(key => field(lang + "_book_" + key, label(key), {
      value: translation[key], textarea: key === "description", full: key === "description",
    })).join("") + '</div>' +
    '<details><summary>' + t("information") + '</summary><div class="stack">' +
    texts.map(key => field(lang + "_content_" + key, label(key), {
      value: pages[key], textarea: true, attrs: 'maxlength="12000"',
    })).join("") + '</div></details>' +
    Object.keys(columns).map(key => collection(lang, key, pages[key])).join("") + '</div></details>';
}

function collection(lang, key, entries) {
  return '<details><summary>' + t(aliases[key] ?? key) + '</summary><div>' +
    '<div data-collection="' + lang + ":" + key + '">' + entries.map(entry => collectionRow(lang, key, entry)).join("") + '</div>' +
    button(bilingual("Adaugă un element", "Add an item"), 'type="button" data-add-entry="' + lang + ':' + key + '"', "button--ghost") + '</div></details>';
}

function collectionRow(lang, key, entry) {
  const stem = lang + "_" + key + "_" + ++collectionSequence + "_";
  return '<div class="collection-item" data-entry="' + stem + '"><div class="form-grid">' +
    Object.entries(columns[key]).map(([name, keyLabel]) => field(stem + name, label(keyLabel), {
      value: entry[name], textarea: ["answer", "quote", "contribution", "description"].includes(name),
    })).join("") + '</div>' +
    checkbox(stem + "approved", bilingual("Publică acest element", "Publish this item"), entry.approved ? "checked" : "") +
    '<button class="text-button" type="button" data-remove-entry>' + t("remove") + '</button></div>';
}

function checkoutStates(current) {
  return statuses.filter(key => key === current || allowedMoves[current]?.includes(key))
    .map(key => [key, t(key === "cancelled" ? "fulfilmentCancelled" : key)]);
}

function orderCard(order) {
  const address = order.shipping;
  const addressLine = [address.line1, address.line2, address.city, address.county, address.postalCode, address.country].filter(Boolean).join(", ");
  return '<details><summary>' + esc(order.number) + ' · ' + localDate(order.createdAt) + ' · ' +
    t(paymentLabels[order.status]) + ' · ' + money(order.totalMinor) +
    (order.mode !== "stripe_live" ? ' · ' + t("demoOrder") : '') +
    '</summary><div class="stack"><p>' + esc(order.quantity) + ' × ' + esc(order.title) +
    (order.preorder ? ' · ' + t("preorder") : "") + '</p><p>' + esc(order.name) + ' · ' + esc(order.email) + '</p>' +
    '<p>' + esc(addressLine) + ' · ' + esc(address.phone) + '</p>' +
    (order.status === "paid"
      ? '<form class="card-form" data-order="' + order.id + '">' +
        selectField("status", t("delivery"), checkoutStates(order.fulfillment), order.fulfillment) +
        button(t("save"), 'type="submit"', "button--ghost") + formStatus + '</form>'
      : '') + '</div></details>';
}

function safeResetLink(message) {
  if (message.kind !== "password-reset") return "";
  const match = message.text.match(/^https?:\/\/[^\s]+$/m);
  if (!match) return "";
  const url = new URL(match[0]);
  if (url.origin !== location.origin || !/^\/(en\/)?account\/reset$/.test(url.pathname)) return "";
  return action(url.href, t("reset"), "button--ghost");
}

function mailCard(message) {
  return '<details><summary>' + esc(message.subject) + ' · ' + localDate(message.createdAt) +
    '</summary><div class="stack"><p>' + esc(message.to) + '</p><pre class="mail-text">' + esc(message.text) +
    '</pre>' + safeResetLink(message) + '</div></details>';
}

function adminNavigation(tab) {
  const options = [
    ["settings", bilingual("Catalog și conținut", "Catalogue and content")],
    ["orders", t("orders")],
    ["mail", bilingual("E-mailuri", "Emails")],
  ];
  return '<nav class="admin-navigation action-row" aria-label="' + t("admin") + '">' + options.map(([key, text]) =>
    '<a class="button ' + (tab === key ? '' : 'button--ghost') + '" href="' + path("admin?tab=" + key) + '"' +
    (tab === key ? ' aria-current="page"' : "") + '>' + esc(text) + '</a>').join("") + '</nav>';
}

export async function adminPage(profile) {
  const heading = pageHeading(t("admin"));
  if (!profile.canAdmin) {
    const intro = bilingual("Acces pentru administratorul magazinului.", "For the shop administrator.");
    if (!profile.user) return heading + section(notice(intro) + '<div class="action-row">' +
      action(path("account"), t("signIn")) + '</div>', "narrow");
    return heading + section('<form id="admin-setup" class="card card-form"><p>' + intro + '</p>' +
      field("secret", bilingual("Cheia de instalare", "Setup secret"), {
        type: "password", attrs: 'required maxlength="400" autocomplete="off"',
      }) + button(bilingual("Activează accesul", "Activate access"), 'type="submit"') + formStatus + '</form>', "narrow");
  }
  const tab = params.get("tab");
  if (tab === "orders") {
    const { orders } = await api("admin/orders");
    return heading + section(adminNavigation(tab) + '<div class="admin-pane stack">' +
      (orders.length ? orders.map(orderCard).join("") : notice(bilingual("Nu există comenzi.", "There are no orders."))) + '</div>');
  }
  if (tab === "mail") {
    const { mail } = await api("admin/test-mail");
    return heading + section(adminNavigation(tab) + '<div class="admin-pane stack">' +
      '<h2>' + bilingual("Căsuța de test", "Test inbox") + '</h2>' +
      (mail.length ? mail.map(mailCard).join("") : notice(bilingual("Căsuța de test este goală.", "The test inbox is empty."))) +
      '<form id="retry-mail" class="card-form">' +
      button(bilingual("Reîncearcă e-mailurile de producție", "Retry production emails"), 'type="submit"', "button--ghost") +
      formStatus + '</form></div>');
  }
  const result = await api("admin/settings");
  revision = result.revision;
  return heading + section(adminNavigation("settings") + settingsForm(result));
}

function readSettings(form, data) {
  const minor = (key) => data[key] ? Math.round(Number(data[key]) * 100) : null;
  const date = (key) => data[key] ? new Date(data[key]).toISOString() : null;
  const translatedCatalog = (lang) => Object.fromEntries(catalogFields.map(key => [key, data[lang + "_book_" + key]]));
  const translatedContent = (lang) => {
    const content = Object.fromEntries(texts.map(key => [key, data[lang + "_content_" + key]]));
    for (const [key, entries] of Object.entries(columns)) {
      const group = form.querySelector('[data-collection="' + lang + ':' + key + '"]');
      content[key] = [...group.querySelectorAll("[data-entry]")].map(row => ({
        ...Object.fromEntries(Object.keys(entries).map(name => [name, data[row.dataset.entry + name]])),
        approved: Boolean(data[row.dataset.entry + "approved"]),
      }));
    }
    return content;
  };
  return {
    catalog: {
      ...translatedCatalog("en"),
      translations: { ro: translatedCatalog("ro") },
      coverUrl: data.coverUrl, contactEmail: data.contactEmail, availability: data.availability,
      regularPriceMinor: minor("regularPriceMinor"), preorderPriceMinor: minor("preorderPriceMinor"),
      deliveryMinor: minor("deliveryMinor"), offerStartsAt: date("offerStartsAt"), offerEndsAt: date("offerEndsAt"),
      offerApproved: Boolean(data.offerApproved),
    },
    content: { ...translatedContent("en"), translations: { ro: translatedContent("ro") } },
  };
}

export function bindAdmin(root) {
  const settings = root.querySelector("#admin-settings");
  settings?.addEventListener("click", event => {
    const add = event.target.closest("[data-add-entry]");
    if (add) {
      const [lang, key] = add.dataset.addEntry.split(":");
      const collection = settings.querySelector('[data-collection="' + lang + ':' + key + '"]');
      collection.insertAdjacentHTML("beforeend", collectionRow(lang, key, {}));
      collection.lastElementChild.querySelector("input,textarea")?.focus();
    }
    const remove = event.target.closest("[data-remove-entry]");
    if (remove) {
      const entry = remove.closest("[data-entry]");
      entry.parentElement.nextElementSibling?.focus();
      entry.remove();
    }
  });
  handleForm(settings, async (data) => {
    const next = readSettings(settings, data);
    const result = await api("admin/settings", { method: "PUT", body: { revision, settings: next } });
    revision = result.revision;
    formMessage(settings, t("saved"), true);
  });
  handleForm(root.querySelector("#admin-setup"), async (data) => {
    await post("admin/setup", data);
    location.reload();
  });
  for (const order of root.querySelectorAll("[data-order]")) {
    handleForm(order, async ({ status }) => {
      await api("admin/orders/" + order.dataset.order, { method: "PATCH", body: { status } });
      const options = checkoutStates(status).map(([name, text]) => new Option(text, name, name === status, name === status));
      order.elements.namedItem("status").replaceChildren(...options);
      formMessage(order, t("saved"), true);
    });
  }
  const retry = root.querySelector("#retry-mail");
  handleForm(retry, async () => {
    const result = await post("admin/mail-retry");
    formMessage(retry, bilingual("Mesaje trimise", "Messages sent") + " " + result.sent + " / " + result.attempted, true);
  });
}
