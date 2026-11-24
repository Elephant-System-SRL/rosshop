import { readBrandAsset } from "./brand.mjs";
import { handleApi } from "./api.mjs";
import { configuredOrigin } from "./core.mjs";

const pageSections = new Set([
  "", "about", "shop", "pricing", "gallery", "testimonials", "partners", "sponsors",
  "faq", "contact", "cart", "checkout", "account", "dashboard", "admin", "privacy",
  "terms", "delivery", "returns",
]);
const indexedSections = new Set(["", "about", "shop", "pricing", "gallery", "testimonials", "partners", "faq", "contact"]);
const descriptions = {
  ro: "RouterOS pas cu pas, cartea practică Educat IT cu explicații și laboratoare MikroTik RouterOS.",
  en: "RouterOS pas cu pas, the Educat IT book with practical explanations and hands-on MikroTik RouterOS labs.",
};

const mediaTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.openai.com",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
};

function addResponseHeaders(response, headers) {
  const result = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) {
    result.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: result,
  });
}

function decodePath(rawPath) {
  try {
    const path = decodeURIComponent(rawPath);
    if (/[\\\u0000-\u001f]/.test(path) || path.split("/").some(segment => segment.startsWith("."))) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

function localizedDocument(bytes, { language, tail, indexable }, origin) {
  const seo = origin && indexable
    ? '<link rel="canonical" href="' + origin + (language === "en" ? "/en" : "") + tail + '">' +
      '<link rel="alternate" hreflang="ro" href="' + origin + tail + '">' +
      '<link rel="alternate" hreflang="en" href="' + origin + "/en" + tail + '">'
    : "";
  return new TextDecoder().decode(bytes)
    .replace(/(<html\b[^>]*\blang=["'])[^"']+(["'])/i, `$1${language}$2`)
    .replaceAll("{{store-description}}", descriptions[language])
    .replace("{{store-locale}}", language === "ro" ? "ro_RO" : "en_GB")
    .replace("{{store-noscript}}", language === "ro"
      ? "Activează JavaScript pentru a folosi magazinul."
      : "Enable JavaScript to use the store.")
    .replace("<!-- store-seo -->", seo);
}

function documentRoute(path) {
  const english = path === "/en" || path.startsWith("/en/");
  const pagePath = english ? path.slice(3) || "/" : path;
  const language = english ? "en" : "ro";
  if (pagePath === "/index.html" || pagePath === "/") {
    return { language, status: 200, tail: "/", indexable: true };
  }
  if (pagePath.includes(".")) return null;
  const tail = pagePath.replace(/\/$/, "");
  const section = tail.split("/")[1];
  const standard = tail === "/" + section && pageSections.has(section);
  const account = /^\/account\/(register|forgot|reset|unsubscribe)$/.test(tail);
  const receipt = /^\/checkout\/receipt\/[a-f0-9-]{36}$/.test(tail);
  return { language, tail, status: standard || account || receipt ? 200 : 404,
    indexable: standard && indexedSections.has(section) };
}

function crawlerResponse(path, origin) {
  if (path === "/robots.txt") {
    return origin
      ? "User-agent: *\nDisallow: /api/\nDisallow: /admin\nDisallow: /en/admin\nSitemap: " + origin + "/sitemap.xml\n"
      : "User-agent: *\nDisallow: /\n";
  }
  if (path !== "/sitemap.xml" || !origin) return null;
  const pages = ["", "/en"].flatMap(prefix => Array.from(indexedSections, section => prefix + "/" + section));
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    pages.map(page => "<url><loc>" + origin + page + "</loc></url>").join("") + "</urlset>";
}

export function createWorker(readAsset, { preview = false } = {}) {
  return {
    async fetch(request, env, ctx) {
      const parsed = new URL(request.url);
      const path = decodePath(parsed.pathname);
      if (path === null) {
        return addResponseHeaders(new Response("Invalid path", { status: 400 }), securityHeaders);
      }

      try {
        if (path === "/api" || path.startsWith("/api/")) {
          const response = await handleApi(request, env, ctx);
          return addResponseHeaders(response, {
            ...securityHeaders,
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex",
          });
        }

        if (request.method !== "GET" && request.method !== "HEAD") {
          return addResponseHeaders(new Response("Method not allowed", { status: 405 }), {
            ...securityHeaders,
            Allow: "GET, HEAD",
          });
        }

        const head = request.method === "HEAD";
        const origin = !preview && env.PUBLIC_STOREFRONT === "true" ? configuredOrigin(env) : null;
        const crawl = crawlerResponse(path, origin);
        if (crawl !== null) {
          return addResponseHeaders(new Response(head ? null : crawl), {
            ...securityHeaders,
            "Content-Type": mediaTypes[path === "/robots.txt" ? ".txt" : ".xml"],
            "Cache-Control": "no-store",
          });
        }

        const route = documentRoute(path);
        const indexingHeaders = origin && route?.indexable ? {} : { "X-Robots-Tag": "noindex, nofollow" };
        const asset = readBrandAsset(path) ?? await readAsset(route ? "/index.html" : path);
        if (!asset) {
          return addResponseHeaders(new Response(head ? null : "Page not found", { status: 404 }), {
            ...securityHeaders,
            ...indexingHeaders,
            "Content-Type": mediaTypes[".txt"],
          });
        }

        const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
        const type = route ? mediaTypes[".html"] : mediaTypes[extension] ?? "application/octet-stream";
        const body = route ? localizedDocument(asset, route, origin) : asset;
        return addResponseHeaders(new Response(head ? null : body, { status: route?.status ?? 200 }), {
          ...securityHeaders,
          ...indexingHeaders,
          ...(route ? { "Content-Language": route.language } : {}),
          "Content-Type": type,
          "Cache-Control": preview ? "no-store" : route ? "no-cache" : "public, max-age=300",
        });
      } catch (error) {
        console.error("Store request failed", error instanceof Error ? error.name : "UnknownError");
        const api = path === "/api" || path.startsWith("/api/");
        const response = api
          ? Response.json({ error: "The store is temporarily unavailable." }, { status: 500 })
          : new Response("The store is temporarily unavailable.", { status: 500 });
        return addResponseHeaders(response, { ...securityHeaders, "Cache-Control": "no-store" });
      }
    },
  };
}
