# RouterOS pas cu pas · Magazinul Educat IT

Magazinul oferă interfață, cont client și e-mailuri tranzacționale în română și engleză. Cartea prezentată este ediția tipărită în limba română. Prețurile inițiale sunt **349 RON** standard, **249 RON** promoțional și **26 RON** livrare per comandă în România. Totalul promoțional pentru un exemplar este **275 RON**. Administratorul poate modifica sumele din catalog.

## Instalare pe cPanel Meridian

Selectează repository-ul la rădăcină, Node.js 24, comanda de build `npm run build`, directorul rezultat `dist` și comanda de pornire `node app.js`. Aplicația ascultă portul din `PORT`. Datele SQLite și migrațiile aplicate se păstrează în directorul privat `~/.local/share/rosshop`. Pe o găzduire cu volume separate, setează `STORE_DATA_DIR` la un director persistent și accesibil utilizatorului aplicației. Fă o copie de siguranță a bazei înainte de migrare.

Originea implicită este `https://educatit.ro`. Instalarea inițială oferă simularea comenzilor. Configurează secretele de plată, e-mail și administrare în cPanel când activezi acele funcții.

## Previzualizare locală

Extrage arhiva și deschide un terminal în directorul `educatit-routeros-store`. Cu Node.js 24, rulează `npm run dev` și deschide [magazinul de test](http://127.0.0.1:4173/). Pentru interfața în engleză, folosește comutatorul din antet.

1. Deschide **Magazin**, adaugă cartea în coș și verifică totalul.
2. Finalizează comanda cu date fictive. Poți comanda ca vizitator sau poți crea un cont pentru a urmări comanda.
3. Alege rezultatul de simulare în pagina de plată de test. O plată de test confirmată generează un mesaj în căsuța din administrare.
4. Pentru administrare, creează un cont local și deschide [pagina de administrare](http://127.0.0.1:4173/admin). Cheia de instalare este generată la prima pornire în `.local/admin-bootstrap.txt`. Aceasta atribuie rolul de administrator primului cont activat. Folosește cheia doar în instanța locală.

Datele de test se păstrează în `.local/store-preview.sqlite`. Comenzile de test folosesc o plată simulată și o căsuță locală pentru mesaje.

## Verificare

- `npm test` verifică prețurile, coșul, comenzile de vizitator și de cont, izolarea conturilor, resetarea parolei, istoricul de preț și stările de plată.
- `npm run build` produce un Worker pentru Cloudflare și migrațiile pentru baza D1, în `dist/`.
- Zona de administrare include catalog, disponibilitate, termeni comerciali, galerie, parteneri, recenzii și statusul expediției.

## Activare pe educatit.ro

1. Completează datele comerciantului, termenii, confidențialitatea, livrarea și retururile în ambele limbi. Încarcă imaginea copertei finale și introdu adresa ei în catalog. Adaugă informația de expediere și intervalul promoției, dacă oferta este limitată.
2. Publică Workerul cu migrațiile și bindingul D1 `DB`. Configurează domeniul și setează `APP_ORIGIN` la originea HTTPS confirmată. Pentru indexarea magazinului public, setează `PUBLIC_STOREFRONT=true`.
3. Configurează `ADMIN_BOOTSTRAP_SECRET` ca secret de instalare pentru primul administrator. Elimină-l din configurație după activare. Setează `STRIPE_MODE=test`, `STRIPE_SECRET_KEY` și `STRIPE_WEBHOOK_SECRET` în mediul de test. Configurează ruta `/api/payments/stripe` pentru evenimentele `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` și `checkout.session.expired`. Verifică accesul Stripe la rută, plata și confirmarea. [Documentația Stripe Checkout](https://docs.stripe.com/checkout/fulfillment)
4. Configurează un expeditor verificat cu `EMAIL_MODE=live`, `RESEND_API_KEY` și `EMAIL_FROM`. Verifică expedierea e-mailurilor tranzacționale în mediul de lansare.
5. Pentru deschiderea vânzărilor, dezactivează `DEMO_MODE`, configurează cheile de producție cu `STRIPE_MODE=live`, confirmă condițiile din catalog și setează disponibilitatea. Magazinul acceptă comenzi reale după validarea configurației și aprobarea datelor comerciale.

Previzualizarea folosește o machetă de copertă. Prețurile și tariful afișate sunt cele comunicate pentru carte. Orice exemplu de laborator marcat ilustrativ este o demonstrație a modului de lucru.
