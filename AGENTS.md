# AGENTS.md — Kalkulator Mierników

> Dokument dla nowego agenta/narzędzia AI, który przejmuje pracę nad tym projektem.
> Przeczytaj go w całości przed pierwszą zmianą w kodzie.

---

## 1. Czym jest ten projekt

**Kalkulator Mierników** to aplikacja webowa (PWA) wspierająca lekcje elektrotechniki
i miernictwa. Rozwiązuje problem „policz mi to krok po kroku" — uczeń wpisuje dane
z zadania, a aplikacja pokazuje nie tylko wynik, ale i **całe wyprowadzenie**, więc da się
je przepisać do zeszytu i zrozumieć.

Dla kogo: **uczniowie i nauczyciel przedmiotów elektrycznych (ET)** — pierwowzorem był
szkolny arkusz `PODZAIŁKI_ET.xlsx` do odczytywania wskazań amperomierza i woltomierza.

Zakres: wskazania mierników i niepewności pomiarowe, systemy liczbowe, II prawo Kirchhoffa,
układy równań metodą Cramera oraz obliczanie prądów gałęzi w obwodzie.

**Status: MVP działający i używany** — aplikacja jest opublikowana i używana na lekcjach
(GitHub Pages, adres w `README.md`). Nie jest to prototyp; zmiany należy traktować jak
pracę na kodzie produkcyjnym.

---

## 2. Stos technologiczny

| Technologia | Wersja / uwagi | Dlaczego |
|---|---|---|
| HTML + CSS + **vanilla JavaScript** | bez frameworka, bez transpilacji | Cała aplikacja to **jeden plik**, który da się wysłać mailem, otworzyć z dysku i wgrać na dowolny hosting statyczny |
| Nowoczesny JS | ES2017+ (arrow functions, `const/let`, template literals, `BigInt`, `padStart`) | Wystarcza w każdym współczesnym Chrome/Safari; świadomie **nie używamy** `?.` ani `.flat()`, żeby nie odciąć starszych telefonów |
| SVG (inline) | rysowanie schematu obwodu | Skalowalne, ostre na każdym ekranie, zero zależności i zero plików graficznych |
| `localStorage` | klucz `kalkulator-miernikow-v1` | Trwały stan bez backendu; odczyt w `try/catch`, bo w trybie prywatnym i na `file://` potrafi rzucić |
| Service Worker | `sw.js`, cache `mierniki-vN` | Działanie **offline** po pierwszej wizycie |
| Web App Manifest | `manifest.webmanifest` | Instalacja jako aplikacja (Android, iOS, desktop) |
| GitHub Pages | gałąź `main`, katalog główny | Darmowy hosting + automatyczny deploy po `git push` |

**Zależności: BRAK.** Nie ma `package.json`, `node_modules`, bundlera ani transpilera.
To decyzja, nie brak czasu — patrz sekcja 4.

---

## 3. Struktura projektu

```
Kalkulator-Miernikow/
├── index.html              # CAŁA aplikacja: 6 zakładek, HTML + CSS + JS inline (~800 linii)
├── sw.js                   # service worker: precache plików + strategia network-first
├── manifest.webmanifest    # metadane PWA: nazwa, opis, ikony, tryb standalone
├── icon-180.png            # ikona apple-touch-icon (iOS)
├── icon-192.png            # ikona PWA (Android)
├── icon-512.png            # ikona PWA + wariant maskable
├── README.md               # dokumentacja dla użytkownika (PL) + link do wersji online + 4 zrzuty
├── screenshot-mierniki.png     # zrzuty ekranu użyte w README
├── screenshot-kirchhoff.png
├── screenshot-rownania.png
├── screenshot-obwod.png
├── PODZAIŁKI_ET.xlsx       # szkolny arkusz źródłowy (protoplasta zakładki mierników).
│                           #   NIE jest używany przez aplikację — leży jako dokumentacja
└── AGENTS.md               # ten plik
```

**Nie ma katalogu `src/`, `dist/`, `tests/` ani `.github/`.** Jeśli dodajesz testy lub CI,
twórz nowe katalogi i opisz je tutaj.

---

## 4. Architektura i kluczowe decyzje

### 4.1 Szkielet `index.html`

Kolejność bloków w `<script>` jest istotna (wszystko to jeden zakres globalny):

1. `METERS` — konfiguracja przyrządów (id, tytuł, jednostki, domyślny zakres/działki/klasa).
2. `KEY` + wczytanie `state` z `localStorage`.
3. **Helpery globalne** (patrz 4.4).
4. `ALL` — lista zakładek, `show(id)` + generowanie przycisków, pętla `METERS` budująca karty mierników.
5. Po jednym **IIFE na zakładkę**: SYSTEMY, II PRAWO KIRCHHOFFA, UKŁAD RÓWNAŃ, OBWÓD.
6. Podpowiedzi instalacji (iOS / `beforeinstallprompt`).
7. `show(...)` — pierwsze wyświetlenie, oraz rejestracja service workera.

### 4.2 Wzorzec zakładki (trzymaj się go przy dodawaniu nowej)

```js
(function(){
  const sec=document.createElement("section");sec.className="card";
  const st=state.X=state.X||{};        // 1. własny fragment stanu + NORMALIZACJA starych danych
  sec.innerHTML=`...`;                  // 2. szablon HTML
  app.appendChild(sec);cards.X=sec;     // 3. rejestracja w cards{} (wymagane przez show())
  function build(){...}                 // 4. przebudowa DOM — TYLKO przy zmianach strukturalnych
  function calc(){...}                  // 5. obliczenia + render wyników
  build();
})();
```

**Zasada krytyczna:** `calc()` **nie może nadpisywać `.value` pól wejściowych**, w których
użytkownik właśnie pisze. Nadpisanie `.value` przestawia kursor na koniec i psuje wpisywanie
na telefonie. Aktualizujemy wyłącznie pola wynikowe (`.textContent`, `innerHTML` wyników).
Jeśli musisz zsynchronizować pole, użyj warunku `if(el.value!==nowaWartosc)el.value=nowaWartosc`.

Nowa zakładka = nowy wpis w `ALL` **plus** `cards[<id>]=sekcja` w jej IIFE.
Nagłówek zakładki na pasku bierze się z pola `tab` (krótki) albo `title` (długi).

### 4.3 Stan aplikacji

Jeden obiekt `state` zapisywany w całości pod kluczem `kalkulator-miernikow-v1`:

| Klucz | Zakładka |
|---|---|
| `state.a`, `state.v` | AMPEROMIERZ, VOLTOMIERZ (`{range,max,unit,cls,alfa[11]}`) |
| `state.n` | SYSTEMY (`{val,from,to}`) |
| `state.k` | II PRAWO KIRCHHOFFA (`{rows:[{kind,sign,unk,e,i,r}]}`) |
| `state.r` | UKŁAD RÓWNAŃ (`{n,names[3],c[3][4]}`) |
| `state.o` | OBWÓD (`{br:[{name,dir,el:[{t,v,d}]}]}`) |
| `state.tab` | id ostatnio otwartej zakładki |

Zasady:
* `save()` po każdej zmianie (w środku `calc()`),
* **każda zakładka normalizuje swój fragment na starcie** — użytkownik może mieć w przeglądarce
  stan z dużo starszej wersji albo ręcznie zepsuty; brak normalizacji = wyjątek = **cała
  aplikacja przestaje działać**, bo skrypt jest jeden,
* `state.o` filtruje wpisy niebędące obiektami, `state.k` odtwarza brakujące wiersze itd. —
  nie usuwaj tych zabezpieczeń.

### 4.4 Helpery globalne (używaj ich, nie duplikuj)

| Helper | Działanie |
|---|---|
| `num(s)` | parsuje liczbę **z przecinkiem** dziesiętnym; `null` gdy nie liczba |
| `fmt(n)` | formatuje liczbę: max 6 miejsc, **przecinek**, `–` dla `null` |
| `fv(n)` | jak `fmt`, ale z prawdziwym minusem `−` (U+2212) — **używaj do każdej wartości, która może być ujemna** |
| `escA(s)` | escapuje `& < > "` — **każda wartość od użytkownika wstawiana do HTML** |
| `valV(s)` | dla `number` → `fv`, dla stringa → `escA` (domyślne wartości pól) |
| `save()` | zapis `state` do `localStorage` w `try/catch` |

### 4.5 Decyzje podjęte i OD RZUCONE (nie odwracaj ich bez uzgodnienia)

* **Jeden plik, zero zależności, zero backendu.** Odrzucono React/Vue i bundler: aplikacja ma
  działać offline, być do wysłania jako jeden plik i nie wymagać utrzymywania toolchainu.
  Dane użytkownika **nigdy nie opuszczają przeglądarki**.
* **Rozpoznawanie schematu ze zdjęcia — USUNIĘTE (commit `12fb7e4`).** Było zaimplementowane
  (model z obsługą obrazów + klucz API użytkownika). Właściciel zdecydował, że chce rozwiązanie
  w pełni lokalne i bez żadnych zewnętrznych usług — sekcja i cały jej kod zostały usunięte.
  **Nie przywracaj tego bez wyraźnej prośby.**
* **OBWÓD liczy metodą napięcia międzywęzłowego** `U_AB = (∑E/R)/(∑1/R)`, a nie przez
  rozwiązywanie układu równań. Powód: jeden wzór działa dla dowolnej liczby gałęzi, jest krótszy
  i mniej podatny na błędy znaków. Dodatkowo aplikacja **wypisuje równania z I i II prawa
  Kirchhoffa** (dla porównania z rozwiązaniem w zeszycie) i sprawdza oba prawa na wynikach.
* **Service worker jest network-first**, nie cache-first. Świadomie: użytkownik ma dostawać
  nową wersję od razu, gdy jest online; cache służy tylko jako fallback offline.
* **Wyniki zaokrąglamy do 3 cyfr znaczących**, a dokładną wartość (6 miejsc) pokazujemy
  w krokach obliczeń. Powód: `7/15` zapisane jako `0,466667` jest nieczytelne, a `0,467`
  wystarcza do zeszytu — ale w wyprowadzeniu chcemy pełną wartość.
* **Pasek zakładek to stała siatka 3 kolumn** (przy 6 zakładkach daje 2 rzędy).
  Odrzucono `auto-fit`, bo przy różnych szerokościach ucinał etykiety.
* **Zakładka II PRAWO KIRCHHOFFA obsługuje JEDNO oczko** (sprawdzenie bilansu lub wyliczenie
  jednej niewiadomej). Do całego obwodu służy zakładka OBWÓD — to celowy podział, nie brak funkcji.

### 4.6 Wdrożenie

* Hosting: **GitHub Pages**, gałąź `main`, katalog `/`, włączone HTTPS, deploy automatyczny.
* Po każdej zmianie **plików aplikacji** (`index.html`, ikony, manifest) **podbij
  `const CACHE="mierniki-vN"` w `sw.js`** — to konwencja repo i sygnał dla przeglądarki,
  że precache ma się odświeżyć. Zmiany wyłącznie dokumentacyjne (`README.md`, `AGENTS.md`)
  **nie wymagają** podbijania wersji cache.
* GitHub Pages wysyła `cache-control: max-age=600` — **przez ~10 minut po deployu użytkownik
  może widzieć starą wersję**. W komunikacji z użytkownikiem podawaj adres z parametrem
  (`...?v=6`), który omija cache.

---

## 5. Konfiguracja i uruchomienie

### Wymagane narzędzia

* **Nic** do samego działania aplikacji (wystarczy przeglądarka).
* **Python 3** (lub dowolny serwer statyczny) — tylko po to, żeby działał service worker
  i instalacja PWA. Otwarcie `index.html` wprost z dysku też działa, ale bez offline.
* **git** — do publikacji.
* Node.js **nie jest potrzebny** do aplikacji. Jeśli dodajesz testy w Node, użyj Node 20+.

### Uruchomienie krok po kroku

```bash
git clone https://github.com/SigPath/Kalkulator-Miernikow.git
cd Kalkulator-Miernikow

# serwer lokalny (wymagany dla service workera / trybu offline)
python3 -m http.server 8000

# Otwórz: http://localhost:8000
```

Szybka weryfikacja, że plik nie ma błędu składni (bez przeglądarki):

```bash
python3 - <<'PY'
import re
s=open('index.html',encoding='utf8').read()
open('/tmp/app.js','w',encoding='utf8').write(re.findall(r'<script>(.*?)</script>',s,re.S)[-1])
PY
node --check /tmp/app.js && echo "SYNTAX OK"
```

Publikacja:

```bash
git add -A && git commit -m "..." && git push origin main
# GitHub Pages przebuduje się w ~1 minutę
```

### Zmienne środowiskowe

**Projekt nie używa żadnych zmiennych środowiskowych i nie ma pliku `.env`.**
Nie ma tu żadnych sekretów ani kluczy API — i celowo ma ich nie być. Jeśli kiedykolwiek
pojawi się potrzeba sekretu, to znaczy, że łamana jest zasada z sekcji 4.5 (brak backendu,
dane nie opuszczają przeglądarki) i wymaga to uzgodnienia z właścicielem.

### Adresy

| Środowisko | Adres |
|---|---|
| lokalnie | `http://localhost:8000` |
| produkcja | `https://sigpath.github.io/Kalkulator-Miernikow/` |

### Tożsamość git

W repozytorium ustawiono **lokalną** tożsamość gita (`.git/config`, bez zmian globalnych):
`Marcin Burda <burda.marcin1985@gmail.com>`. Zachowaj ją przy commitach.

---

## 6. Konwencje

**Język**
* Cały interfejs, komentarze w kodzie, `README.md`, `AGENTS.md` i **komunikaty commitów**:
  **po polsku**.
* Polska typografia: przecinek dziesiętny, cudzysłowy `„…”`, minus `−` (U+2212),
  znak `·` jako separator mnożenia, `∑`, `Ω`, `α`, `δ`, `Δ`.

**Kod**
* Wcięcie **1 spacja** wewnątrz IIFE (taki jest styl całego pliku — trzymaj się go).
* `const` domyślnie, `let` gdy trzeba; funkcje strzałkowe; brak średników na końcu
  wyrażeń jednolinijkowych tam, gdzie reszta pliku ich nie stawia.
* Kod kompaktowy: CSS w jednej linii na regułę, `innerHTML` z template literals.
* **Nie dodawaj nowych zależności, frameworków ani plików buildu bez zgody właściciela.**
* **Nie używaj** `?.`, `.flat()`, `replaceAll()` ani innych składni mogących wyciąć starsze
  telefony bez testu na nich.
* Każdą wartość pochodzącą od użytkownika wstawianą do HTML przepuść przez `escA`/`valV`.
  Każdą wartość liczbową, która może być ujemna, formatuj przez `fv`.

**Zmiany**
* Zmieniając istniejącą zakładkę **przetestuj też pozostałe** — skrypt jest wspólny, wyjątek
  w jednej zakładce potrafi zablokować całą aplikację (łącznie z pierwszym `show()`).
* Po zmianie plików: **podbij `CACHE` w `sw.js`**, zaktualizuj `README.md`, a jeśli zmienił
  się wygląd — **odśwież zrzuty ekranu** (`screenshot-*.png`).
* Nie zmieniaj formatowania `manifest.webmanifest` ani innych plików „przy okazji" —
  trzymaj diffy minimalne (zdarzyło się już, że `json.dump` rozdmuchał cały plik).

---

## 7. Aktualny stan prac

Ostatni commit: **`12fb7e4` — „OBWÓD: usunięcie rozpoznawania schematu ze zdjęcia"**.
Repozytorium lokalne = zdalne, `git status` czysty, GitHub Pages `status=built`.

### ✅ Zrobione i działające

* **AMPEROMIERZ / VOLTOMIERZ** — stała `C = zakres/działki`, wskazanie `α·C`,
  `Δ = klasa·zakres/100`, `δ = Δ/wartość`, średnia ± Δ, 11 pomiarów, jednostki A/mA i V/mV.
* **SYSTEMY** — bin/okt/dec/hex krok po kroku (`BigInt`), metoda skrótowa dla potęg dwójki,
  wagi pozycji i dzielenie z resztą, walidacja cyfr, zamiana systemów.
* **II PRAWO KIRCHHOFFA** — równanie jednego oczka: sprawdzenie bilansu albo wyliczenie
  jednej niewiadomej (E, I lub R) z pełnym wyprowadzeniem i sprawdzeniem.
* **UKŁAD RÓWNAŃ** — 2–3 równania liniowe metodą Cramera: wyznacznik główny, `Wx/Wy/Wz`
  (reguła Sarrusa), dzielenie, podstawienie sprawdzające; obsłużony przypadek `W = 0`.
* **OBWÓD** — dwa węzły + N gałęzi równoległych: edytor gałęzi i elementów (R, E ze
  strzałkami), **rysowany na żywo schemat SVG**, napięcie międzywęzłowe, wszystkie prądy,
  równania I i II prawa Kirchhoffa oraz sprawdzenie. Przycisk **„Przykład z dokumentu"**
  odtwarza zadanie: `U_AB = 0,6 V`, `I1 = 7/15 A`, `I2 = 11/15 A`, `I3 = 1,2 A`.
* **PWA** — manifest, ikony (192/512/maskable + 180 dla iOS), service worker offline,
  podpowiedzi instalacji dla iOS i Chrome.
* **README.md** — opis wszystkich zakładek, wzory, tok pracy, 4 zrzuty, instrukcja uruchomienia.
* **Wdrożenie** — GitHub Pages aktywne, cache `mierniki-v10`.

### 🚧 W trakcie

**Nic — praca zakończona w czystym punkcie.** Wszystkie funkcje są wdrożone, przetestowane
i opublikowane. Nie ma niedokończonego kodu ani zacommitowanych połowicznych zmian.

### 📋 Do zrobienia (w kolejności)

1. **Przenieść testy do repozytorium** — patrz sekcja 8, punkt pierwszy. Priorytet najwyższy.
2. Opcjonalnie: solver obwodów o **dowolnej liczbie węzłów** (dziś OBWÓD obsługuje dwa).
3. Opcjonalnie: dostępność — `role="tab"` bez nawigacji klawiaturą i bez `role="tabpanel"`.
4. Opcjonalnie: plik `LICENSE`.
5. Opcjonalnie: osobna zakładka z **I prawem Kirchhoffa** (prądowym) w stylu obecnych.

---

## 8. Znane problemy i ograniczenia

**Najważniejsze — brak testów w repozytorium.** W trakcie rozwoju powstał zestaw testów
end-to-end (170 sprawdzeń: mierniki 33, Kirchhoff 51, równania 40, obwód 41, `file://` 5)
sterujących prawdziwym Chrome przez DevTools Protocol. Zestaw **żyje jednak poza repo**
w katalogu tymczasowym i **nie jest wersjonowany** — jeśli nie zostanie przeniesiony do
repozytorium, przepadnie. To główny dług techniczny: bez niego każda zmiana wymaga ręcznego
przeklikanie całej aplikacji. Odtworzenie lub przeniesienie tego zestawu jest zadaniem numer jeden.

* **Brak `package.json`, lintera, CI i jakichkolwiek testów w repo.**
* **Cache po wdrożeniu** — GitHub Pages trzyma stronę (`max-age=600`) i do tego działa service
  worker, więc po `git push` użytkownik może przez ~10 minut widzieć starą wersję.
  Obejście: adres z parametrem `?v=N` albo twarde odświeżenie.
* **Service worker jest network-first** — pierwsze wejście **offline, bez wcześniejszej wizyty
  online**, nie zadziała (nie ma czego serwować z cache). To akceptowalne, ale warto wiedzieć.
* **Zakładka OBWÓD obsługuje tylko dwa węzły.** Obwody o innej topologii trzeba rozwiązać
  w UKŁADZIE RÓWNAŃ, wpisując równania ręcznie.
* **II PRAWO KIRCHHOFFA to jedno oczko**, nie cały obwód — celowy podział (patrz 4.5).
* **UKŁAD RÓWNAŃ: maksymalnie 3 równania** i brak obsługi `W = 0` innej niż komunikat
  (układ nieoznaczony/sprzeczny nie jest rozwiązywany).
* **Formatowanie liczb**: 6 miejsc po przecinku, brak zapisu naukowego i obsługi bardzo
  dużych/małych wartości; `fmt` zwraca `–` dla `null`, więc nie da się odróżnić „brak danych"
  od „błąd" w niektórych miejscach.
* **Mierniki: stała liczba 11 pomiarów** (`const N=11`) — nie da się dodać kolejnych wierszy.
* **Dostępność**: pasek zakładek ma `role="tab"`, ale bez obsługi strzałek i bez `tabpanel`.
* **`PODZAIŁKI_ET.xlsx`** nie jest używany przez aplikację — leży jako dokument źródłowy.
  Nie usuwaj go bez pytania.
* **Brak pliku `LICENSE`** — projekt nie ma określonej licencji.
* Zdarza się, że operacje masowe na plikach (np. `json.dump`) rozdmuchują diffy — pilnuj
  minimalnych zmian w `manifest.webmanifest`.

---

## 9. Następne kroki

**Priorytet 1 — odtworzyć i wpiąć testy (to odblokowuje bezpieczną pracę nad resztą).**
* Zbudować harness w Node sterujący Chrome przez DevTools Protocol (wystarczy globalny
  `WebSocket` z Node 22+, zero zależności npm — tak działał poprzedni).
* Uruchamiać Chrome z flagami: `--headless=new --no-sandbox --disable-setuid-sandbox
  --disable-crash-reporter --disable-breakpad --disable-extensions --disable-gpu
  --user-data-dir=<tmp>`; bez `--no-sandbox` Chrome nie wstaje w środowisku sandboxa.
* Uważać na dwa typowe błędy harnessu: czekać aż `location.href` przestanie być `about:blank`
  (Chrome startuje z pustej strony), oraz na starcie czyścić `localStorage` i przeładowywać
  stronę, żeby testy się nie zazębiały.
* Pokryć co najmniej: wskazania mierników i `δ`, konwersje systemów, bilans i rozwiązywanie
  w II PRAWIE KIRCHHOFFA, Cramera (2×2 i 3×3, `W = 0`), OBWÓD (dokładnie przykład z dokumentu:
  `I1 = 0,467 A`, `I2 = 0,733 A`, `I3 = 1,2 A`, `U_AB = 0,6 V`), escapowanie danych
  użytkownika oraz trwałość stanu po przeładowaniu.
* Testować też po `file://` — aplikacja ma tam działać.

**Priorytet 2 — rozszerzyć solver obwodu na dowolną liczbę węzłów**, jeśli pojawi się taka
potrzeba. Naturalna droga: metoda potencjałów węzłowych (macierz konduktancji) + rozwiązanie
układem równań, z wykorzystaniem istniejącej machinerii wyznacznikowej z UKŁADU RÓWNAŃ.

**Priorytet 3 — drobne**: `LICENSE`, dostępność paska zakładek, ewentualna zakładka
z I prawem Kirchhoffa.

**Przy każdej zmianie pamiętaj o:** podbiciu `CACHE` w `sw.js`, aktualizacji `README.md`,
odświeżeniu zrzutów przy zmianach wyglądu i sprawdzeniu, że **pozostałe zakładki nadal działają**.
