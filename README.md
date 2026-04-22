# Oxygen Warehouse Helper

Εργαλείο για χρήστες του [Oxygen Pelatologio](https://oxygen.gr) που καλύπτει τρία κενά στο υπάρχον UI:

1. **Δημιουργία προϊόντων από παραστατικά ΑΑΔΕ** (μόνο Chrome extension, λόγω scraping του modal)
2. **Αναζήτηση στον κατάλογο** από οπουδήποτε (extension + web app)
3. **Πρόχειρα λίστες** αγορών που μετατρέπονται σε Δελτία/Τιμολόγια (extension + web app)
4. **Βοηθός AI (JARVIS)** — ρωτάς με φυσική γλώσσα για τα δεδομένα σου, απαντάει χρησιμοποιώντας τοπικά εργαλεία

Διαθέσιμο σε δύο μορφές:

- **Chrome extension** — πλήρης λειτουργικότητα, ιδανικό για desktop όπου έχεις ανοιχτή την εφαρμογή Oxygen
- **Web app / PWA** — λειτουργεί σε κινητό και desktop, installable ως εφαρμογή μέσω "Add to Home Screen"

---

## Περιεχόμενα

- [Χαρακτηριστικά](#χαρακτηριστικά)
- [Εγκατάσταση](#εγκατάσταση)
- [Ρυθμίσεις](#ρυθμίσεις)
- [Χρήση](#χρήση)
- [Πρόχειρα & Δελτία](#πρόχειρα--δελτία)
- [Βοηθός AI (JARVIS)](#βοηθός-ai-jarvis)
- [Αντιμετώπιση προβλημάτων](#αντιμετώπιση-προβλημάτων)
- [Ανάπτυξη (για developers)](#ανάπτυξη-για-developers)

---

## Χαρακτηριστικά

### Flow 1 — Δημιουργία προϊόντων από παραστατικό ΑΑΔΕ _(μόνο Chrome)_

Όταν ανοίγεις ένα παραστατικό από τη λίστα «Παραστατικά σε εκκρεμότητα» στο Oxygen, εμφανίζεται ένα κουμπί **"➕ Δημιουργία νέων"**. Με ένα κλικ:

- Διαβάζονται όλες οι γραμμές του τιμολογίου (περιγραφή, ποσότητα, τιμή, ΦΠΑ, κωδικός προμηθευτή)
- Ταυτοποιείται ο προμηθευτής μέσω ΑΦΜ (με αυτόματη δημιουργία αν δεν υπάρχει, μέσω `/vat-check`)
- Ανιχνεύονται πιθανά duplicate προϊόντα
- Ανοίγει φόρμα προ-συμπληρωμένη με όλα τα πεδία της Oxygen: Περιγραφή, SKU, Τύπος, Κατηγορία, Μονάδα, Barcode, PC ή PN, CPV, TARIC, Όριο αποθέματος, τιμές αγοράς/πώλησης, ΦΠΑ, myData κατηγορίες
- Υποστηρίζει παραλλαγές (π.χ. "ΠΑΧΟΣ ΜΕΛΑΜΙΝΗΣ" με πολλές τιμές → δημιουργεί αυτόματα ένα προϊόν ανά παραλλαγή με κωδικό `5.1`, `5.2`...)
- Αποστολή ως `POST /products` με όλα τα πεδία

### Flow 2 — Αναζήτηση στον τοπικό κατάλογο

- Τοπικός cache όλων των προϊόντων (IndexedDB + MiniSearch) — ταχύτατη αναζήτηση offline
- Fuzzy matching για ορθογραφικά λάθη (π.χ. `Ferrara` → `FERARRA`)
- Στήριξη Ελληνικών tonos-insensitive (π.χ. `ΠΛΑΚΆΚΙΑ` = `πλακακια`)
- Δύο επίπεδα αποτελεσμάτων: **Ακριβής αντιστοίχιση** (code / barcode / MPN) και **Πιθανές αντιστοιχίσεις** (fuzzy)
- Από δεξί κλικ σε επιλεγμένο κείμενο οπουδήποτε στον browser _(extension)_
- Από 📍 κουμπί που διαλέγεις το όνομα προϊόντος με κλικ σε στοιχείο σελίδας _(extension)_
- Από αυτόματο εντοπισμό σε προϊοντικές σελίδες (JSON-LD / OpenGraph / heuristic) _(extension)_
- Από απευθείας πληκτρολόγηση στην καρτέλα Αναζήτηση _(extension + web)_

### Flow 3 — Πρόχειρα & Δελτία

- Καρφιτσώνεις προϊόντα σε ένα πρόχειρο από οπουδήποτε _(extension: δεξί κλικ, web app: manual)_
- Επεξεργάζεσαι το πρόχειρο με πλήρη editor: πελάτης, σειρά αρίθμησης, ημερομηνίες, γραμμές με Αναζήτηση/Περιγραφή/Μ/Μ/Ποσότητα/Τιμή/Έκπτωση/ΦΠΑ/Σύνολα
- Υποστήριξη "Η τιμή περιλαμβάνει ΦΠΑ" toggle με σωστή αντιστροφή των υπολογισμών
- Υποβολή ως **Δελτίο Παραγγελίας** (`POST /notices`)
- Προαιρετική μετατροπή σε **Τιμολόγιο** (`POST /invoices` με `notice_id`)
- Για ταιριασμένα προϊόντα: στέλνουμε μόνο `{code, quantity}` και ο server συμπληρώνει τα υπόλοιπα
- Για manual γραμμές: στέλνουμε πλήρες breakdown με default myDATA classification

### Flow 1β — Τιμολόγιο από PDF / φωτογραφία (web app + extension)

Όταν έχεις ένα τιμολόγιο σε χαρτί ή PDF και δεν θέλεις/δεν μπορείς να χρησιμοποιήσεις το AADE modal (π.χ. είσαι σε κινητό):

1. Άνοιξε την οθόνη **"Από τιμολόγιο"** (κάμερα icon)
2. Τράβα φωτογραφία ή επίλεξε αρχείο (PDF, JPG, PNG)
3. Το Claude Vision διαβάζει το αρχείο και εντοπίζει:
   - Προμηθευτή (όνομα, ΑΦΜ, διεύθυνση)
   - Ημερομηνία έκδοσης
   - Γραμμές (περιγραφή, ποσότητα, τιμή, ΦΠΑ)
4. Εμφανίζεται η **ίδια φόρμα επεξεργασίας** όπως στο Flow 1
5. Ο προμηθευτής δημιουργείται αυτόματα αν δεν υπάρχει (μέσω `/vat-check`)
6. Πάτημα "Δημιουργία επιλεγμένων" → τα προϊόντα μπαίνουν στον κατάλογο

**Περιορισμός**: τα προϊόντα + ο προμηθευτής δημιουργούνται, αλλά η εγγραφή **δαπάνης/εξόδου** παραμένει manual στο Oxygen UI — το Oxygen API δεν έχει ακόμα endpoint για δαπάνες. Όταν προσθέσουν ένα, θα προσθέσουμε κουμπί "Δημιουργία δαπάνης".

### Flow 4 — Βοηθός AI (JARVIS)

- Νέα καρτέλα στο popup
- Ενεργοποιείται **μόνο** όταν η ερώτηση ξεκινά με `JARVIS tell me` ή `JARVIS πες μου` — εξοικονομούμε tokens
- Τοπικές εντολές με `/` για άμεσες απαντήσεις χωρίς API call: `/search`, `/product`, `/stock`, `/drafts`, `/stats`, `/help`
- Ο βοηθός έχει πρόσβαση μέσω 13 εργαλείων read-only: αναζήτηση, λεπτομέρειες προϊόντων, λίστες επαφών, ΦΠΑ, αποθήκες, κατηγορίες, παραλλαγές, πρόχειρα, αποθέματα κ.ά.
- Αποθήκευση ιστορικού συνομιλιών (📜) — μπορείς να ξαναδείς ή να συνεχίσεις παλιές συνομιλίες
- Collapsible βοήθεια (ℹ) στην επάνω δεξιά γωνία
- Καθαρισμός τρέχουσας συνομιλίας (🗑) ανοίγει νέα session

---

## Εγκατάσταση

### Chrome Extension (desktop)

**Επιλογή Α — από το GitHub Release:**

1. Πάνε στο [Releases](https://github.com/Basilakis/oxygen-chrome/releases)
2. Κατέβασε το `oxygen-helper-{version}.zip` από το τελευταίο release
3. Αποσυμπίεσε σε έναν φάκελο
4. Άνοιξε `chrome://extensions` στον Chrome
5. Ενεργοποίησε το **Developer mode** (πάνω δεξιά)
6. Πάτησε **Load unpacked** και επίλεξε τον φάκελο που έκανες unzip
7. Η επέκταση εμφανίζεται στη γραμμή εργαλείων

**Επιλογή Β — από source (για developers):**

```bash
git clone https://github.com/Basilakis/oxygen-chrome.git
cd oxygen-chrome
npm install
npm run build
# Μετά: chrome://extensions → Load unpacked → επίλεξε τον φάκελο dist/
```

### Web app / PWA (κινητό + desktop)

1. Άνοιξε στο browser: **`https://oxygen-helper.vercel.app`** (ή όπου έχει γίνει deploy το δικό σου fork)
2. **Σε κινητό**: πάτησε Share → "Add to Home Screen" (iOS) ή "Install app" (Android Chrome)
3. **Σε desktop**: πάτησε το εικονίδιο εγκατάστασης στη γραμμή URL του Chrome (συνήθως δεξιά, δίπλα στο bookmark)
4. Η εφαρμογή ανοίγει πλέον σε ξεχωριστό παράθυρο χωρίς browser chrome

---

## Ρυθμίσεις

### 1. Oxygen API Token

Απαραίτητο για όλες τις λειτουργίες.

1. Συνδέσου στο `app.pelatologio.gr`
2. Πάνε στις Ρυθμίσεις του λογαριασμού σου → **API Tokens**
3. Δημιούργησε νέο token
4. Αντιγραφή
5. Στο Oxygen Helper:
   - **Extension**: δεξί κλικ στο εικονίδιο → Options (ή από το popup → link "Ρυθμίσεις" κάτω δεξιά)
   - **Web app**: καρτέλα **Ρυθμίσεις** → ενότητα **Πιστοποίηση**
6. Επικόλληση στο πεδίο **"Bearer token"**
7. Πάτησε **"Δοκιμή σύνδεσης"** — πρέπει να εμφανιστεί `✓ Η σύνδεση λειτουργεί`
8. Πάτησε **"Αποθήκευση"**

> Το Oxygen token αποθηκεύεται **τοπικά** (`chrome.storage.local` για το extension, `localStorage` για το web app). Δεν φεύγει ποτέ από τον browser σου — οι κλήσεις προς `api.oxygen.gr` γίνονται απευθείας από τον client.

### 2. Πλήρης συγχρονισμός

Μετά την επιτυχή σύνδεση:

1. Πήγαινε στην ενότητα **"Συγχρονισμός"**
2. Πάτησε **"Πλήρης συγχρονισμός"**
3. Περίμενε να κατέβουν όλα τα δεδομένα (λίγα δευτερόλεπτα έως λίγα λεπτά, ανάλογα με το μέγεθος του καταλόγου σου)
4. Τα counts εμφανίζονται στην κάτω ενότητα: προϊόντα, επαφές, ΦΠΑ, αποθήκες, κ.ά.

Ο αυτόματος συγχρονισμός τρέχει κάθε 60 λεπτά. Μπορείς να αλλάξεις το διάστημα.

### 3. Προεπιλογές (προαιρετικά)

Αφού γίνει ο πλήρης συγχρονισμός, ξεκλειδώνει η ενότητα **"Προεπιλογές"**:

- Προεπιλεγμένη αποθήκη
- Προεπιλεγμένη κατηγορία προϊόντων
- Προεπιλεγμένος ΦΠΑ
- Αρίθμηση τιμολογίων / δελτίων
- Τρόπος πληρωμής
- Λογότυπο
- Προεπιλεγμένη μονάδα μέτρησης

Όλα αυτά θα χρησιμοποιηθούν ως defaults στις φόρμες δημιουργίας.

### 4. SKU & τιμολόγηση

- **Στρατηγική παραγωγής SKU**:
  - _Αυτόματος εντοπισμός μοτίβου_ (default) — ανιχνεύει το μοτίβο από τον υπάρχοντα κατάλογο
  - _Αύξων αριθμός_ — απλά incrementing integers (1, 2, 3...) όπως στο Oxygen default
  - _Με πρόθεμα_ — π.χ. `OX-0001`
  - _Ανά κατηγορία_ — π.χ. `ΠΛΑΚ-001`
- **Markup πώλησης** — ποσοστό πάνω στην τιμή αγοράς για πρόταση τιμής πώλησης

### 5. Συμπεριφορά

- **Αυτόματη δημιουργία προμηθευτή** μέσω `/vat-check` αν δεν υπάρχει _(συνιστάται)_
- **Αυτόματος εντοπισμός προϊόντος** σε σελίδες — ενεργοποιεί το floating badge σε προϊοντικές σελίδες _(extension)_
- **Ειδοποιήσεις** για σφάλματα σύνδεσης 401

### 6. Βοηθός AI

Το κλειδί του Anthropic μπαίνει σε **διαφορετικό μέρος** για κάθε shell:

- **Extension (BYOK)** — Ρυθμίσεις → Βοηθός AI → επικόλληση του `sk-ant-...` key. Αποθηκεύεται τοπικά στο `chrome.storage.local` και στέλνεται απευθείας στο `api.anthropic.com`. Κάθε χρήστης βάζει το δικό του key.
- **Web app (self-hosted σε Vercel)** — το key αποθηκεύεται **server-side** ως env var `ANTHROPIC_API_KEY` στο Vercel dashboard. Κάθε κλήση περνάει μέσα από το edge function `api/anthropic/messages.ts` που κάνει inject το key. Ο browser ποτέ δεν το βλέπει. Ο χρήστης δεν χρειάζεται να βάλει τίποτα στο UI.

Μοντέλα: Claude Sonnet 4.6 (προεπιλογή), Opus 4.7, ή Haiku 4.5.

---

## Χρήση

### Άνοιγμα extension

Κλικ στο εικονίδιο στη γραμμή εργαλείων του Chrome → ανοίγει ξεχωριστό παράθυρο 480×720. Το παράθυρο παραμένει ανοιχτό μέχρι να το κλείσεις.

### Καρτέλες

- **Αναζήτηση** — άμεση fuzzy αναζήτηση στον τοπικό κατάλογο
- **Πρόχειρα** — editor πρόχειρων, λίστα πρόχειρων, υποβολή ως Δελτίο
- **Βοηθός** — AI chat με JARVIS
- **Κατάσταση** — σύνδεση, πλήθη δεδομένων, manual sync
- **Ρυθμίσεις** _(μόνο web app)_ — όλες οι ενότητες settings inline (στο extension είναι σε ξεχωριστή options page)

### Αναζήτηση προϊόντος

**Extension:**

1. Άνοιξε το extension
2. Καρτέλα Αναζήτηση → πληκτρολόγησε περιγραφή, SKU, barcode, MPN, ή κωδικό προμηθευτή
3. Αποτελέσματα εμφανίζονται σε 2 ομάδες: Ακριβής αντιστοίχιση (πράσινη), Πιθανές αντιστοιχίσεις (γκρι)
4. Πάτησε **"Στο πρόχειρο"** για να προσθέσεις προϊόν στο ενεργό πρόχειρο

**Από οπουδήποτε στον browser:**

- **Δεξί κλικ σε επιλεγμένο κείμενο** → "Αναζήτηση στην αποθήκη" → ανοίγει floating card με αποτελέσματα
- **Δεξί κλικ → "Oxygen: Επιλογή τίτλου προϊόντος από σελίδα"** → cursor γίνεται crosshair, κλικ στον τίτλο → ανοίγει αναζήτηση
- **Κουμπί 📍 στην καρτέλα Αναζήτηση** → ενεργοποιείται picker στην ενεργή καρτέλα browser

### Δημιουργία προϊόντος από τιμολόγιο _(Flow 1, extension only)_

1. Άνοιξε ένα παραστατικό στη λίστα "Παραστατικά σε εκκρεμότητα" του Oxygen
2. Στο modal "Προβολή Παραστατικού ΑΑΔΕ" εμφανίζεται το κουμπί **"➕ Δημιουργία νέων"** (είτε μέσα στο footer, είτε επάνω δεξιά ως floating)
3. Κλικ → ανοίγει φόρμα σε ξεχωριστό overlay
4. Ο προμηθευτής αναγνωρίζεται αυτόματα από το ΑΦΜ. Αν δεν υπάρχει, δημιουργείται αυτόματα μέσω `/vat-check`
5. Κάθε γραμμή του τιμολογίου εμφανίζεται εκτεταμένη με όλα τα πεδία της Oxygen
6. **Προϊόν με παραλλαγές** (switcher πάνω σε κάθε γραμμή): ενεργοποίησε για να διαλέξεις τύπο παραλλαγής (π.χ. ΠΑΧΟΣ ΜΕΛΑΜΙΝΗΣ) και πολλαπλές τιμές (8, 18, 25). Θα δημιουργηθεί ένα προϊόν ανά τιμή.
7. Ξεμαρκάρεις τις γραμμές που δε θες να δημιουργηθούν (π.χ. duplicate)
8. Πάτησε **"Δημιουργία επιλεγμένων"**
9. Επιτυχίες μαρκάρονται ως "ΥΠΑΡΧΕΙ", αποτυχίες εμφανίζουν το exact 422 validation error από το server

---

## Πρόχειρα & Δελτία

### Δημιουργία πρόχειρου

**Αυτόματα**: δεξί κλικ σε οποιαδήποτε σελίδα → "Καρφίτσωμα στο τρέχον πρόχειρο" (αν δεν υπάρχει ενεργό, δημιουργείται νέο).

**Manual**: Καρτέλα Πρόχειρα → **"+ Νέο πρόχειρο"**

### Επεξεργασία

Το ενεργό πρόχειρο έχει editor με τρεις ενότητες, ίδιες όπως στο Oxygen UI:

1. **Στοιχεία επαφής**:
   - Αναζήτηση πελάτη (autocomplete από local cache)
   - Σειρά αρίθμησης, No (# Αυτόματα), Ημ. Έκδοσης (default: σήμερα), Ημ. Λήξης (default: +15 μέρες), Κατηγορία

2. **Υπηρεσίες & Προϊόντα** (table):
   - Στήλες: #, Αναζήτηση (SKU lookup), Περιγραφή, Μ/Μ, Ποσ., Τιμή €, Έκπτωση, Αξία (computed), ΦΠΑ%, Τελική (computed), ×
   - Checkbox "Η τιμή μονάδας περιλαμβάνει το ΦΠΑ" αντιστρέφει τους υπολογισμούς
   - Σύνολα κάτω: Αξία + Τελική
   - **"+ Προσθήκη γραμμής"** για manual γραμμές

3. **Υποβολή** — διαθέσιμη όταν έχεις πελάτη + τουλάχιστον μία γραμμή resolved

### Διαγραφή πρόχειρου

Δύο σημεία:

- Στη **λίστα πρόχειρων** επάνω (πάντα ορατή): **"Διαγραφή"** σε κάθε row
- Στο **topbar του editor** του ενεργού πρόχειρου: **"🗑 Διαγραφή"** (δεξιά)

### Υποβολή

1. Επιβεβαιώνεις τα στοιχεία
2. Πάτησε **"Υποβολή ως Δελτίο"**
3. Επιτυχία → το πρόχειρο γίνεται `status: submitted`
4. Γίνεται ερώτηση "Μετατροπή σε Τιμολόγιο;" — αν ναι, δημιουργείται invoice με `notice_id`

---

## Βοηθός AI (JARVIS)

### Πρόθεμα ενεργοποίησης

Για να σταλεί η ερώτηση στο Claude, πρέπει να ξεκινά με ένα από τα εξής (case-insensitive):

- `JARVIS tell me ...` (Αγγλικά)
- `JARVIS πες μου ...` (Ελληνικά)
- `JARVIS πες μας ...`
- `JARVIS εξήγησέ μου ...`
- `JARVIS βρες ...`

Χωρίς αυτό το πρόθεμα, η ερώτηση **δε στέλνεται στο Claude** (δε χρεώνονται tokens).

### Παραδείγματα

- `JARVIS tell me how many products I have and the 5 most expensive`
- `JARVIS πες μου ποιοι είναι οι προμηθευτές μου με ΑΦΜ που ξεκινά από 094`
- `JARVIS βρες τα πλακάκια με απόθεμα κάτω από 10 τεμάχια`

### Τοπικές εντολές (χωρίς AI)

Ξεκινούν με `/`:

| Εντολή | Τι κάνει |
|---|---|
| `/search <όρος>` | Αναζήτηση στον τοπικό κατάλογο |
| `/product <κωδικός>` | Λεπτομέρειες προϊόντος |
| `/stock <κωδικός>` | Αποθέματα ανά αποθήκη |
| `/drafts` | Λίστα όλων των πρόχειρων |
| `/stats` | Συνολικά μεγέθη (count ανά είδος) |
| `/help` | Λίστα εντολών |

### Ιστορικό συνομιλιών 📜

- Κάθε συνομιλία αποθηκεύεται αυτόματα μετά από κάθε μήνυμα
- Κλικ στο 📜 icon (επάνω δεξιά) → λίστα παλιών συνομιλιών
- Κλικ σε μια συνομιλία → φορτώνεται ως current (μπορείς να συνεχίσεις)
- × δίπλα σε κάθε συνομιλία για ατομική διαγραφή
- "Διαγραφή όλων" για clear-all
- Capacity: 50 συνομιλίες (οι παλαιότερες πέφτουν αυτόματα)

---

## Αντιμετώπιση προβλημάτων

### "Extension context invalidated"

Έκανες reload την επέκταση αλλά η σελίδα ήταν ήδη ανοιχτή. Οι παλιοί content scripts δεν μπορούν πια να επικοινωνήσουν με την επέκταση. **Λύση**: Ανανέωσε τη σελίδα (Ctrl+R ή το κουμπί "Ανανέωση" στο banner που εμφανίζεται).

### "Could not establish connection" στο picker

Η επέκταση προσπάθησε να στείλει μήνυμα σε καρτέλα που δεν έχει φορτώσει τα content scripts. Συνήθως γιατί:

- Η σελίδα ήταν ανοιχτή πριν εγκατασταθεί/ξαναφορτωθεί η επέκταση
- Η σελίδα είναι chrome:// ή κάτι παρόμοιο (εκεί δε μπορεί να γίνει injection)

**Λύση**: Η επέκταση τώρα κάνει αυτόματα inject το content script με `chrome.scripting.executeScript`. Αν και αυτό αποτύχει (σπάνιο), εμφανίζεται κουμπί **"Ανανέωση"** που ανανεώνει την καρτέλα.

### "δεν κατάφερε να διαβάσει το παραστατικό"

Ο scraper βρήκε το modal αλλά όχι τον πίνακα γραμμών. Άνοιξε F12 → Console. Θα δεις logs `[oxygen-helper:scraper]` που δείχνουν ακριβώς πού απέτυχε. Συνήθως αιτία: υπάρχουν πολλαπλοί πίνακες με κλάση `tableThinOpen` και ο scraper πήρε λάθος. Ενημέρωσέ μας στέλνοντας το outer HTML του modal.

### Η αναζήτηση δεν επιστρέφει αποτελέσματα για σωστή περιγραφή

- Έλεγξε ότι έχει τρέξει **Πλήρης συγχρονισμός** τουλάχιστον μία φορά
- Η αναζήτηση είναι fuzzy-aware: μπορεί να χρειαστεί 3+ χαρακτήρες
- Αν η αναζήτηση στο local αποτύχει, γίνεται αυτόματη πτώση στο server-side `/products?search=` ως fallback

### "Token απέτυχε (401)"

Το saved token έχει λήξει ή ανακληθεί. Πάνε Ρυθμίσεις → Πιστοποίηση → νέο token από το Oxygen → **Δοκιμή σύνδεσης**.

### Ο Βοηθός JARVIS δε στέλνει τίποτα στο Claude

Έλεγξε ότι η ερώτηση **ξεκινά** με `JARVIS tell me` ή `JARVIS πες μου`. Χωρίς το πρόθεμα, η ερώτηση δε στέλνεται εντελώς (feature για εξοικονόμηση tokens).

### Δεν εμφανίζονται παραλλαγές στο prefill modal

Τρέξε **Πλήρης συγχρονισμός** — το endpoint `/variations` πιθανόν δεν έχει κατέβει ακόμα. Μετά από sync, το dropdown θα γεμίσει.

---

## Ανάπτυξη (για developers)

### Τεχνολογίες

- **TypeScript** + **Vite**
- **@crxjs/vite-plugin** (MV3 extension build)
- **MiniSearch** (local full-text search, offline)
- **idb** (IndexedDB wrapper)
- **Claude Messages API** για τον AI βοηθό (Sonnet 4.6 default)
- **Vercel** Edge Functions για Anthropic proxy (web app)

### Αρχιτεκτονική δύο shells με κοινό κώδικα

Το project έχει έναν κώδικα που τρέχει σε **δύο shells**:

```
┌─────────────────────────────────────────────────────────┐
│           shared code (src/ — 95% του codebase)         │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌────────────┐   │
│  │  popup/  │ │ options/ │ │ shared/ │ │  core/     │   │
│  │   UI     │ │ sections │ │  types  │ │ kv (auto)  │   │
│  └──────────┘ └──────────┘ └─────────┘ └────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │           background/handler.ts                  │   │
│  │  (pure message router — no chrome.* side-effects │   │
│  │   at load; consumable από ΚΑΙ τα δύο shells)     │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────┬───────────┘
               │                              │
     ┌─────────▼──────────┐        ┌─────────▼─────────┐
     │ Extension shell    │        │ Web shell (PWA)   │
     │ src/background/    │        │ src/shells/web/   │
     │ src/content/       │        │ api/anthropic/    │
     │ src/popup/         │        │ (Vercel edge fn)  │
     │ manifest.json      │        │ manifest.webmanif.│
     │ → dist/            │        │ → dist-web/       │
     └────────────────────┘        └───────────────────┘
```

**Key shared pieces** (αλλαγή σε ένα σημείο, ενημερώνονται και τα δύο shells):

- [src/background/handler.ts](src/background/handler.ts) — pure message router
- [src/core/storage/kv.ts](src/core/storage/kv.ts) — `kv()`/`sessionKv()` που αυτόματα πέφτει από `chrome.storage.local` σε `localStorage`
- [src/core/config.ts](src/core/config.ts) — στο web shell φορτώνει `/api/config` στο boot· στο extension επιστρέφει defaults χωρίς network call
- [src/shared/messages.ts](src/shared/messages.ts) — `sendMessage()` με `setLocalDispatcher` hook. Στο extension πάει μέσω `chrome.runtime`, στο web κατευθείαν στο `handler.ts`
- [src/background/api/client.ts](src/background/api/client.ts) — στο extension χτυπάει `api.oxygen.gr` απευθείας· στο web πάει μέσω `/api/oxygen` proxy (με προαιρετικό server-side token)
- [src/background/agent/client.ts](src/background/agent/client.ts) — `isExtensionContext()` επιλέγει API endpoint: extension → `api.anthropic.com` (BYOK), web → `/api/anthropic/messages` (Vercel proxy)

### Τοπικό build

```bash
npm install

# Extension
npm run build              # → dist/ (MV3 bundle έτοιμο για chrome://extensions)
npm run dev                # HMR dev server + crxjs watcher
npm run preview            # serve του dist/

# Web app / PWA
npm run build:web          # → dist-web/ (static bundle + sw.js στο root)
npm run dev:web            # HMR dev server στο http://localhost:5173
npm run preview:web        # serve του dist-web/

# Verification
npm run typecheck          # tsc --noEmit
npm run test:scrape        # AADE invoice scraper fixture regression
```

### Deployment — Chrome Extension

**GitHub Action** ([.github/workflows/build-extension.yml](.github/workflows/build-extension.yml)):

1. Σε κάθε push στο `main` + pull request: τρέχει typecheck + scraper test + build:extension + build:web
2. Σε push tag `v*` (π.χ. `git tag v0.2.0 && git push --tags`):
   - Παράγεται `oxygen-helper-v0.2.0.zip` από το `dist/`
   - Ανεβαίνει ως asset σε νέο GitHub Release (με auto-generated release notes)

Δεν απαιτούνται secrets — το workflow δεν τρέχει κλήσεις σε Anthropic/Oxygen στο CI.

**Manual release:** `npm run build` → zip του `dist/` → upload στο [chrome://extensions](chrome://extensions) σε **Developer mode** → "Load unpacked".

### Deployment — Web app (Vercel)

**Πρώτη φορά:**

1. Login στο [vercel.com](https://vercel.com) και πάτησε **"Add New → Project"**
2. Import το GitHub repo σου
3. **Framework Preset**: Other (το `vercel.json` κάνει override όλα όσα χρειάζονται)
4. Στα **Environment Variables** πρόσθεσε τα κλειδιά που χρειάζεσαι (βλ. πίνακα παρακάτω)
5. **Deploy** → Vercel τρέχει `npm run build:web`, σερβίρει το `dist-web/` + τα edge functions στο `api/`
6. Αυτόματο re-deploy σε κάθε push στο `main`

### Environment variables (Vercel)

| Key | Required | Τι κάνει |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Ναι** (για τον Βοηθό AI) | Το Anthropic key στέλνεται server-side από το `api/anthropic/messages.ts`. Ο browser δεν το βλέπει ποτέ. [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `OXYGEN_API_TOKEN` | Προαιρετικό | Αν το θέσεις, **όλα** τα Oxygen API calls περνούν από το `api/oxygen/[...path].ts` proxy που κάνει inject αυτό το token. Οι χρήστες δεν χρειάζεται να εισάγουν δικό τους token — το UI το εντοπίζει μέσω `/api/config` στο boot και αποκρύπτει το token input. Χρήση: **single-owner** deployment (εσύ είσαι ο μόνος χρήστης σε όλα τα devices). Αν το αφήσεις κενό, το app δουλεύει σε **multi-user** mode: κάθε visitor βάζει το δικό του Bearer token στις Ρυθμίσεις (αποθηκεύεται στο δικό του `localStorage`). |
| `ACCESS_PWD` | Προαιρετικό | Αν το θέσεις, το `middleware.ts` μπλοκάρει όλο το site με **HTTP Basic Auth**. Ο browser εμφανίζει popup — βάζεις οποιοδήποτε username και το password που όρισες. Προστατεύει ένα personal deployment από random visitors. Συνιστάται σε συνδυασμό με `OXYGEN_API_TOKEN` (αλλιώς ο κώδικάς σου είναι public αλλά τα δεδομένα σου όχι). |

> Το middleware + οι env vars ισχύουν **μόνο** στο web deployment. Το Chrome extension αγνοεί εντελώς αυτό το setup — τρέχει στον browser σου με το δικό σου BYOK token.

**Τι κάνει το [vercel.json](vercel.json):**

- `buildCommand: npm run build:web`
- `outputDirectory: dist-web`
- `/sw.js` → `cache-control: no-cache` (νέες deploys ενημερώνουν αμέσως τον service worker)
- `/assets/*` → `cache-control: max-age=31536000, immutable` (hashed filenames)

**Τι αποκλείει το [.vercelignore](.vercelignore):** extension-only κώδικας (`src/background/index.ts`, `src/content/`, `src/popup/`, `src/options/`, `manifest.json`, `dist/`, `tests/`, `docs/`). Το Vercel deploy έχει **μόνο** ό,τι χρειάζεται για το web shell + το proxy.

### Secrets & tokens — τι πάει πού

| Secret | Αποθήκευση | Ποιος το βλέπει |
|---|---|---|
| **Oxygen Bearer token (extension)** | `chrome.storage.local` στον browser | Μόνο ο χρήστης του extension — κάθε browser/device ξεχωριστό setup |
| **Oxygen Bearer token (web, multi-user mode)** | `localStorage` στον browser του visitor | Μόνο ο visitor — δεν φεύγει από το browser του |
| **Oxygen Bearer token (web, single-owner mode)** | `OXYGEN_API_TOKEN` env var στο Vercel | Μόνο το deployment — ο browser ποτέ. Ο proxy [api/oxygen/[...path].ts](api/oxygen/[...path].ts) το κάνει inject στο `Authorization` header |
| **Anthropic API key (extension, BYOK)** | `chrome.storage.local` στον browser | Μόνο ο χρήστης του extension |
| **Anthropic API key (web)** | `ANTHROPIC_API_KEY` env var στο Vercel | Το deployment — ο browser ποτέ. [api/anthropic/messages.ts](api/anthropic/messages.ts) κάνει inject το key στο `x-api-key` |
| **Access password (web only)** | `ACCESS_PWD` env var στο Vercel | Κανένας — το [middleware.ts](middleware.ts) το συγκρίνει με το basic-auth header που στέλνει ο browser |

> **Σημείωση κόστους:** στο self-hosted Vercel deployment με κοινό `ANTHROPIC_API_KEY`, όλα τα tokens του JARVIS χρεώνονται στον ιδιοκτήτη του Anthropic account. Για πολλαπλούς χρήστες βάλε rate-limit στο edge function ή μοιρασμένο BYOK UI.

### Web deployment modes — ποιο setup σου ταιριάζει

| Χρήση | `OXYGEN_API_TOKEN` | `ACCESS_PWD` | Συμπεριφορά |
|---|---|---|---|
| **Multi-user** (κάθε visitor έχει δικό του Oxygen λογαριασμό) | δεν ορίζεται | συνήθως δεν ορίζεται | Κάθε visitor βάζει το δικό του token στις Ρυθμίσεις. Ο καθένας βλέπει μόνο τα δικά του δεδομένα. Το site είναι public — όποιος ανοίξει το URL χωρίς token βλέπει empty state. |
| **Single-owner, public URL** | ορίζεται | δεν ορίζεται | Εσύ είσαι ο μόνος που πρέπει να χρησιμοποιεί το app, αλλά το URL είναι ανοιχτό. **Κίνδυνος**: οποιοσδήποτε βρει το URL βλέπει τα δεδομένα σου. Αποδεκτό μόνο αν το URL είναι obscure. |
| **Single-owner, protected** _(συνιστάται για personal deployments)_ | ορίζεται | ορίζεται | Εσύ είσαι ο μόνος, και το basic-auth αποκλείει όλους τους άλλους πριν καν φτάσουν στο HTML. Ανοίγεις το URL, ο browser σου ζητάει password, το βάζεις, το app λειτουργεί χωρίς κανένα άλλο setup. |
| **Multi-user, κλειστή ομάδα** | δεν ορίζεται | ορίζεται | Όλοι περνούν από το ίδιο basic-auth password, μετά ο καθένας βάζει το δικό του Oxygen token. |

### Regression testing

```bash
npm run test:scrape
```

Τρέχει το AADE invoice scraper πάνω σε static fixtures στο [tests/fixtures/](tests/fixtures/). Απαιτείται prasing να παραμένει σταθερό μετά από κάθε αλλαγή στον scraper.

### Δομή κώδικα

```
src/
├── shared/                  types, messages, constants, utils (extension + web)
├── core/
│   └── storage/kv.ts        chrome.storage ↔ localStorage auto-detect
├── background/
│   ├── handler.ts           pure message router (no chrome.* side-effects)
│   ├── index.ts             SW lifecycle only (onInstalled, alarms, menus)
│   ├── api/                 Oxygen REST client
│   ├── search/              MiniSearch index
│   ├── sku/                 SKU generation strategies
│   ├── drafts/              drafts manager
│   ├── sync/                bootstrap + incremental sync
│   ├── agent/               Claude agent + tools + sessions
│   │   └── client.ts        routes extension → api.anthropic.com, web → /api/anthropic/messages
│   └── handlers/            flow-specific handlers
├── content/                 content scripts (extension only)
│   ├── scraper/             AADE invoice modal scraper
│   └── overlays/            shadow-DOM overlays (lookup card, prefill modal)
├── popup/                   popup UI (4 tabs — reused ως-έχει στο web)
├── options/                 options page (6 sections — reused ως-έχει στο web)
└── shells/
    └── web/                 web shell entry (index.html, main.ts, sw.ts, manifest)

api/
└── anthropic/messages.ts    Vercel edge function (key injection proxy)

manifest.json                Chrome MV3 manifest (extension-only)
vite.config.ts               extension build config (crxjs plugin)
vite.config.web.ts           web build config (separate root, sw.ts at /sw.js)
vercel.json                  deploy config για Vercel
.vercelignore                αποκλείει extension files από το deploy
.github/workflows/           GitHub Actions για Chrome zip releases
```

Η πλήρης σχεδιαστική απόφαση για το split είναι στο [docs/web-app-plan.md](docs/web-app-plan.md).

---

## Άδεια χρήσης

Προσωπικής χρήσης, single-user. Όχι για αναδιανομή χωρίς άδεια.

## Επικοινωνία

- Issues: [github.com/Basilakis/oxygen-chrome/issues](https://github.com/Basilakis/oxygen-chrome/issues)
