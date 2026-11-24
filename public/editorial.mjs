import { conceptImage, samplePdf, sampleGallery, verifiedChapters } from "./book-media.mjs";
import { faqItems } from "./text.mjs";
import {
  action, button, checkbox, description, english, esc, field, formMessage, formStatus, handleForm, icon,
  localDate, locale, money, navLink, notice, overline, pageHeading, path, post, section, t,
} from "./ui.mjs";

const title = "RouterOS pas cu pas";

export function bookCover(catalog, eager = false) {
  const photo = catalog.coverUrl || conceptImage;
  return '<figure class="cover-figure' + (photo ? ' has-photo' : '') + '">' +
    (photo ? '<img class="cover-photo" src="' + esc(photo) + '" alt="' +
      esc(t(catalog.coverUrl ? "coverAlt" : "coverConceptAlt")) + '" width="900" height="900" ' +
      (eager ? 'fetchpriority="high"' : 'loading="lazy"') + '>' : "") +
    '<div class="cover-built"><div class="book-object" aria-hidden="true"><div class="book-face">' +
    '<strong>RouterOS</strong><small>PAS CU PAS</small><span class="book-orbit"></span></div></div></div>' +
    (catalog.coverUrl ? "" : '<figcaption class="cover-caption">' + t("coverConcept") + '</figcaption>') + '</figure>';
}

export const displayedCatalog = (store) => store.catalog.checkoutMode === "closed" ? store.demo ?? store.catalog : store.catalog;
export const isDemo = (catalog) => ["demo", "stripe_test"].includes(catalog.checkoutMode);
export const isOpen = (catalog) => catalog.checkoutMode !== "closed";
export const statusLabel = (availability) => t({ coming_soon: "comingSoon", preorder: "preorder", available: "available", sold_out: "soldOut" }[availability]);

export function priceDetails(catalog) {
  if (!isOpen(catalog)) return notice(statusLabel(catalog.availability));
  const { regularPriceMinor, preorderPriceMinor, deliveryMinor } = catalog;
  const promo = catalog.availability === "preorder" && preorderPriceMinor < regularPriceMinor;
  const discount = promo ? regularPriceMinor - preorderPriceMinor : 0;
  const priceLabel = t(promo && isDemo(catalog) ? "promo" : promo ? "preorder" : "livePrice");
  const dates = [];
  if (catalog.offerStartsAt) dates.push(localDate(catalog.offerStartsAt));
  if (catalog.offerEndsAt) dates.push(localDate(catalog.offerEndsAt));
  return '<div><p class="subtle">' + priceLabel + '</p><div class="price-row"><strong class="price">' +
    money(promo ? preorderPriceMinor : regularPriceMinor) + '</strong>' +
    (promo ? '<del aria-label="' + t("regular") + '">' + money(regularPriceMinor) + '</del>' : "") + '</div>' +
    (promo ? '<p class="savings">' + t("savings") + ' ' + money(discount) + ' (' + Math.round(discount / regularPriceMinor * 100) + '%)</p>' : "") +
    (dates.length ? '<p class="subtle">' + dates.join(' – ') + '</p>' : "") +
    '<p>' + t("deliveryRomania") + ' <strong>' + money(deliveryMinor) + '</strong></p></div>';
}

function sectionHeader(label, id = "") {
  return '<header class="section-head"><h2' + (id ? ' id="' + id + '"' : '') + '>' + esc(label) + '</h2></header>';
}

const facts = [
  ["book", "chaptersFact", "chaptersCaption"],
  ["lab", "labsFact", "labsCaption"],
  ["box", "printFact", "printCaption"],
];

function labSection() {
  const sections = [
    ["read", "book", "labReadTitle", "labRead", '<div class="diagram"><span class="diagram-node">' +
      icon("laptop") + 'Laptop</span><i></i><span class="diagram-node">' + icon("network") + 'LAN</span><i></i><span class="diagram-node">' +
      icon("router") + 'MikroTik<br>192.168.88.1</span></div>'],
    ["configure", "lab", "labConfigTitle", "labConfig", '<pre class="lab-code">IPv4: 192.168.88.10/24\nGateway: 192.168.88.1</pre>'],
    ["verify", "check", "labVerifyTitle", "labVerify", '<pre class="lab-code">ping 192.168.88.1</pre><div class="sample-check">' + icon("check") + esc(t("labResult")) + '</div>'],
  ];
  return '<section id="laborator" class="signature section"><div class="container split"><div class="section-copy">' +
    '<h2>' + t("signature") + '</h2><p>' + t("signatureDescription") + '</p>' +
    (samplePdf ? '<div class="action-row">' + action(samplePdf, t("sampleLink"), "button--ghost") + '</div>' : "") +
    '</div><div class="sample-card"><div class="sample-card-top"><h3>' + t("labTitle") + '</h3><small>' + t("labDemo") + '</small></div>' +
    '<div class="sample-tabs" role="tablist" aria-label="' + t("labTitle") + '">' +
    sections.map(([key, graphic], i) => '<button id="tab-' + key + '" type="button" role="tab" aria-controls="panel-' + key +
      '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? "0" : "-1") + '">' + icon(graphic) + t(key) + '</button>').join("") + '</div>' +
    sections.map(([key, , heading, text, graphic], i) => '<div class="sample-panel" id="panel-' + key + '" role="tabpanel" aria-labelledby="tab-' +
      key + '" tabindex="0"' + (i ? ' hidden' : '') + '><h3>' + t(heading) + '</h3><p>' + t(text) + '</p>' + graphic + '</div>').join("") +
    '</div></div></section>';
}

function reviews(content) {
  if (!content.testimonials.length) return '<p class="subtle">' + t("noReviews") + '</p>';
  return '<div class="quote-grid">' + content.testimonials.map(item => '<figure class="quote"><blockquote>' +
    esc(item.quote) + '</blockquote><figcaption>' + esc(item.name) + (item.role ? ' · ' + esc(item.role) : '') + '</figcaption></figure>').join("") + '</div>';
}

function supporters(content) {
  return ["partners", "sponsors"].map(key => '<section class="partner-group" aria-label="' + t(key) + '"><h3>' + t(key) + '</h3>' +
    (content[key].length ? '<div class="logo-grid">' + content[key].map(item => '<article class="partner">' +
      (item.logo ? '<img loading="lazy" src="' + esc(item.logo) + '" alt="">' : "") + '<h3>' +
      (item.url ? '<a href="' + esc(item.url) + '">' + esc(item.name) + '</a>' : esc(item.name)) +
      '</h3><p>' + esc(item.contribution) + '</p></article>').join("") + '</div>' : '<p class="subtle">' + t("noSupporters") + '</p>') + '</section>').join("");
}

function faqList(content, limit = Infinity) {
  const entries = content.faq.length
    ? content.faq.map(({ question, answer }) => [question, answer])
    : faqItems[locale];
  return '<div class="faq-list">' + entries.slice(0, limit).map(([question, answer]) =>
    '<details><summary>' + esc(question) + '</summary><p>' + esc(answer) + '</p></details>').join("") + '</div>';
}

function signupForm(store) {
  if (!store.launchSignup) return "";
  return '<form class="card-form" data-signup>' +
    field("email", t("emailAddress"), { type: "email", attrs: 'required maxlength="254" autocomplete="email"' }) +
    checkbox("consent", t("launchConsent"), "required") + navLink("privacy", "privacy") +
    button(t("joinLaunch"), 'type="submit"') + formStatus + '</form>';
}

function offer(store) {
  const catalog = displayedCatalog(store);
  return '<section id="oferta" class="offer section"><div class="container split"><div class="section-copy">' +
    '<h2>' + t(catalog.availability === "preorder" ? "launchOffer" : "livePrice") + '</h2>' +
    description(store.content.delivery || t("shippingPending")) +
    '<div class="action-row">' + action(path("pricing"), t("pricing"), "button--ghost") + '</div></div>' +
    '<div class="offer-card"><h3>' + title + '</h3>' +
    (catalog.edition ? '<p class="subtle">' + esc(catalog.edition) + '</p>' : "") +
    priceDetails(catalog) +
    '<div class="action-row">' + (isOpen(catalog)
      ? action(path("shop"), t(isDemo(catalog) ? "demoOrder" : catalog.availability === "preorder" ? "preorderBook" : "orderBook"))
      : signupForm(store)) + '</div></div></div></section>';
}

export function home(store) {
  const { catalog } = store;
  const shown = displayedCatalog(store);
  const promotional = shown.availability === "preorder";
  const heroPrice = isOpen(shown) ? '<p class="hero-price"><strong>' +
    money(promotional ? shown.preorderPriceMinor : shown.regularPriceMinor) + '</strong>' +
    (promotional ? '<span>' + t("promo") + '</span><del aria-label="' + t("regular") + '">' + money(shown.regularPriceMinor) + '</del>' : "") +
    '</p>' : "";
  return '<section class="hero"><div class="container hero-inner"><div class="hero-copy">' +
    overline(t("heroLabel")) + '<h1>RouterOS <em>pas cu pas</em></h1><p>' + t("heroDescription") + '</p>' + heroPrice +
    '<div class="action-row">' +
    action(path("shop"), t(isOpen(catalog) ? catalog.availability === "preorder" ? "preorderBook" : "orderBook" : "viewBook"), "button--gold") +
    action(samplePdf || "#laborator", t(samplePdf ? "sampleLink" : "viewLab"), "button--light-ghost") +
    '</div><p class="hero-note">' + statusLabel(catalog.availability) + '</p></div>' +
    '<div class="cover-stage">' + bookCover(catalog, true) + '</div></div></section>' +
    '<div class="fact-strip"><div class="container facts">' + facts.map(([graphic, label, sub]) =>
      '<div class="fact">' + icon(graphic) + '<div><h2>' + t(label) + '</h2><p>' + t(sub) + '</p></div></div>').join("") +
    '</div></div>' + labSection() + offer(store) +
    '<section class="section testimonials"><div class="container">' + sectionHeader(t("testimonials")) +
    reviews(store.content) + '</div></section>' +
    '<section class="section partners-section"><div class="container">' + sectionHeader(t("supporters")) +
    supporters(store.content) + '</div></section>' +
    '<section class="section"><div class="container narrow">' + sectionHeader(t("faq")) + faqList(store.content, 3) +
    '<a class="text-link" href="' + path("faq") + '">' + t("faq") + '</a>' +
    '<div class="action-row">' + action(path("shop"), t("viewBook")) + '</div></div></section>';
}

function contents(content) {
  const chapters = content.chapters.length ? content.chapters : verifiedChapters;
  return '<div id="cuprins" class="stack"><h2>' + t("contents") + '</h2>' + (chapters.length
    ? '<ol class="chapter-list">' + chapters.map(entry => '<li><div><strong>' +
      esc(english ? entry.english ?? entry.title : entry.title) + '</strong>' +
      (entry.page ? '<span>' + (english ? "Page " : "Pagina ") + esc(entry.page) + '</span>' : '') + '</div>' +
      description(entry.description) + (entry.href ? '<a class="text-link" href="' + esc(entry.href) + '">' + t("sampleLink") + '</a>' : '') + '</li>').join("") + '</ol>'
    : description(t("topics"))) + '</div>';
}

function gallery(store) {
  const photos = store.content.gallery.length ? store.content.gallery : sampleGallery.map(item => ({
    ...item, title: english ? item.titleEn : item.title, alt: english ? item.altEn : item.alt,
  }));
  const galleryItems = [...photos];
  if (store.catalog.coverUrl || conceptImage) {
    galleryItems.unshift({
      src: store.catalog.coverUrl || conceptImage,
      title: store.catalog.coverUrl ? title : t("coverConcept"),
      alt: t(store.catalog.coverUrl ? "coverAlt" : "coverConceptAlt"),
    });
  }
  return pageHeading(t("gallery"), "", title) + section(
    galleryItems.length
      ? '<div class="gallery-grid">' + galleryItems.map(({ title: label, src, alt, caption }) =>
        '<article><button class="gallery-tile" type="button" data-gallery-src="' + esc(src) +
        '" data-gallery-title="' + esc(label) + '"><img loading="lazy" src="' + esc(src) + '" alt="' + esc(alt) +
        '"><strong>' + esc(label) + '</strong></button>' + description(caption) + '</article>').join("") + '</div>'
      : '<div class="shop-cover">' + bookCover(store.catalog) + '</div>',
  );
}

export function editorialPage(name, store) {
  const { content, catalog } = store;
  switch (name) {
    case "about":
      return pageHeading(title, content.about || t("aboutText"), t("about")) +
        section('<div class="two-col"><div class="stack">' + contents(content) +
          '<div class="action-row">' + action(path("shop"), t("shop")) +
          (samplePdf ? action(samplePdf, t("sampleLink"), "button--ghost") : '') + '</div></div>' +
          '<div class="shop-cover">' + bookCover(catalog) + '</div></div>') + labSection();
    case "pricing":
      return pageHeading(t("pricing"), "", title) + offer(store);
    case "gallery":
      return gallery(store);
    case "testimonials":
      return pageHeading(t("testimonials"), "", title) + section(reviews(content));
    case "partners":
    case "sponsors":
      return pageHeading(t("supporters"), "", title) + section(supporters(content)) +
        section(action(path("contact"), t("contact")));
    case "faq":
      return pageHeading(t("faq"), "", title) + section(faqList(content), "narrow");
    case "contact":
      return pageHeading(t("contact"), t("support"), "Educat IT") + section('<div class="stack">' +
        '<div class="card"><h2>Educat IT</h2>' + description(content.seller) +
        (catalog.contactEmail ? '<a class="text-link" href="mailto:' + esc(catalog.contactEmail) + '">' + esc(catalog.contactEmail) + '</a>' : '') +
        '</div>' + signupForm(store) + '</div>', "narrow");
    case "privacy":
    case "terms":
    case "delivery":
    case "returns":
      return pageHeading(t(name), "", "Educat IT") + section(description(content[name] || t("noPolicy")) +
        '<a class="text-link" href="' + path("contact") + '">' + t("contact") + '</a>', "narrow");
    default:
      return pageHeading(t("notFound")) + section(action(path(), t("home")));
  }
}

export function bindEditorial(root) {
  for (const tabList of root.querySelectorAll('[role="tablist"]')) {
    const tabs = [...tabList.querySelectorAll('[role="tab"]')];
    function activate(index) {
      tabs.forEach((tab, i) => {
        tab.tabIndex = index === i ? 0 : -1;
        tab.setAttribute("aria-selected", String(index === i));
        document.getElementById(tab.getAttribute("aria-controls")).hidden = index !== i;
      });
      tabs[index].focus();
    }
    tabList.addEventListener("click", event => {
      const index = tabs.indexOf(event.target.closest('[role="tab"]'));
      if (index >= 0) activate(index);
    });
    tabList.addEventListener("keydown", event => {
      const previous = tabs.indexOf(event.target);
      const destinations = { ArrowRight: (previous + 1) % tabs.length, ArrowLeft: (previous + tabs.length - 1) % tabs.length,
        Home: 0, End: tabs.length - 1 };
      const next = destinations[event.key];
      if (next === undefined || previous < 0) return;
      event.preventDefault();
      activate(next);
    });
  }
  const lightbox = document.getElementById("lightbox");
  for (const item of root.querySelectorAll("[data-gallery-src]")) {
    item.addEventListener("click", () => {
      lightbox.innerHTML = '<div class="dialog-bar"><strong id="gallery-title">' + esc(item.dataset.galleryTitle) +
        '</strong><form method="dialog">' + button(t("close"), 'type="submit"', "button--ghost") + '</form></div><figure><img src="' +
        esc(item.dataset.gallerySrc) + '" alt="' + esc(item.querySelector("img").alt) + '"></figure>';
      lightbox.setAttribute("aria-labelledby", "gallery-title");
      lightbox.showModal();
    });
  }
  for (const form of root.querySelectorAll("[data-signup]")) {
    handleForm(form, async ({ email, consent }) => {
      await post("subscribe", { email, consent: Boolean(consent), locale });
      form.reset();
      formMessage(form, t("subscribed"), true);
    });
  }
}
