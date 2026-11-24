import { adminPage, bindAdmin } from "./admin.mjs";
import { bindCommerce, cart, commercePage } from "./commerce.mjs";
import { bindEditorial, editorialPage, home } from "./editorial.mjs";
import {
  action, api, english, esc, icon, locale, navLink, notice, page, pageHeading, path, section, t,
} from "./ui.mjs";

const name = page[0] === "index.html" ? "" : page[0] ?? "";
const commerce = new Set(["shop", "cart", "checkout", "account", "dashboard"]);
const app = document.getElementById("app");

function brand() {
  return '<a class="brand" href="' + path() + '"><span class="brand-mark">' + icon("book") +
    '</span><span>Educat <b>IT</b></span></a>';
}

function switchLanguage() {
  const address = new URL(location.href);
  const target = english ? address.pathname.slice(3) || "/" : "/en" + address.pathname;
  return '<a class="lang-link" href="' + esc(target + address.search + address.hash) + '" hreflang="' +
    (english ? "ro" : "en") + '" lang="' + (english ? "ro" : "en") + '" aria-label="' +
    (english ? "Română" : "English") + '">' + icon("globe") + (english ? "RO" : "EN") + '</a>';
}

function header(profile) {
  const navigation = [["about", "about"], ["about#cuprins", "contents"], ["shop", "shop"], ["faq", "faq"]];
  return '<a class="skip" href="#main">' + t("skip") + '</a><header class="header"><div class="container header-inner">' +
    brand() + '<nav id="main-nav" aria-label="' + t("navigation") + '">' +
    navigation.map(([to, key]) => '<a href="' + path(to) + '"' + (name === to ? ' aria-current="page"' : '') + '>' + t(key) + '</a>').join("") +
    '</nav><div class="header-tools">' + switchLanguage() +
    '<a class="tool" aria-label="' + t("account") + '" title="' + t("account") + '" href="' +
    path(profile.user ? "dashboard" : "account") + '">' + icon("user") + '</a>' +
    '<a id="cart-tool" class="tool" aria-label="' + t("cart") + '" title="' + t("cart") + '" href="' + path("cart") + '">' +
    icon("bag") + '<span class="bag-count" aria-hidden="true" hidden></span></a>' +
    '<button class="tool mobile-toggle" type="button" aria-expanded="false" aria-controls="main-nav" aria-label="' + t("menu") +
    '">' + icon("menu") + '</button></div></div></header>';
}

function footer(profile) {
  return '<footer class="footer"><div class="container footer-grid"><div>' + brand() +
    '<p>' + t("heroLabel") + '</p></div><div><h2>RouterOS pas cu pas</h2>' +
    [["about", "about"], ["gallery", "gallery"], ["pricing", "pricing"], ["partners", "supporters"], ["contact", "contact"]]
      .map(([to, key]) => navLink(to, key)).join("") +
    '</div><div><h2>' + t("information") + '</h2>' +
    ["terms", "privacy", "delivery", "returns"].map(key => navLink(key, key)).join("") +
    (profile.canAdmin ? navLink("admin", "admin") : "") +
    '</div></div><div class="container footer-end"><span>© Educat IT</span><span>' + t("imprint") + '</span></div></footer>';
}

function updateCartLabel() {
  const tool = document.getElementById("cart-tool");
  if (!tool) return;
  const count = tool.querySelector(".bag-count");
  const quantity = cart().quantity;
  count.hidden = !quantity;
  count.textContent = quantity;
  tool.setAttribute("aria-label", t("cart") + (quantity ? " (" + quantity + ")" : ""));
}

function bindNavigation() {
  const toggle = document.querySelector(".mobile-toggle");
  const nav = document.getElementById("main-nav");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && nav.classList.contains("is-open")) {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }
  });
  document.addEventListener("educatit-cart-change", updateCartLabel);
  window.addEventListener("storage", updateCartLabel);
  updateCartLabel();
}

async function initialize() {
  let store;
  let profile = {};
  let markup;
  try {
    [store, profile] = await Promise.all([
      api("store?locale=" + locale),
      api("account"),
    ]);
    if (name === "admin") markup = await adminPage(profile);
    else if (commerce.has(name)) markup = await commercePage(name, store, profile);
    else markup = name ? editorialPage(name, store) : home(store);
  } catch {
    markup = pageHeading("RouterOS pas cu pas") + section(notice(t("unavailable"), "error") +
      '<div class="action-row">' + action(location.pathname, t("tryAgain")) + '</div>', "narrow");
  }
  const banner = store?.demo ? '<div class="preview-banner"><div class="container"><strong>' + t("demoBadge") +
    '</strong><span>' + t("demoNote") + '</span></div></div>' : "";
  app.innerHTML = header(profile) + banner + '<main id="main" tabindex="-1">' + markup + '</main>' + footer(profile);
  const pageTitle = app.querySelector("main h1")?.textContent;
  if (pageTitle) document.title = pageTitle + " · Educat IT";
  bindNavigation();
  bindEditorial(app);
  if (store) bindCommerce(app, store);
  if (name === "admin") bindAdmin(app);
  const anchor = location.hash.slice(1);
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
}

void initialize();
