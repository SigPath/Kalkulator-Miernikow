# Rozbudowa: kalkulator naukowy z CAS (styl Casio ClassPad II FX-CP400)

Dokumentacja funkcji dodanych do istniejącej aplikacji „Kalkulator Mierników".
Istniejące zakładki (AMPEROMIERZ, VOLTOMIERZ, SYSTEMY) pozostały bez zmian funkcjonalnych.

## Architektura

```
index.html          — powłoka PWA + istniejące zakładki (bez zmian logiki)
vendor/
  math.min.js       — mathjs 15.2.0 (Apache-2.0): liczby zespolone, macierze, statystyka, numeryka
  nerdamer.all.min.js — nerdamer 2.0.0 (MIT): CAS — upraszczanie, całki, pochodne, równania
js/
  engine.js         — wspólny silnik (UMD: przeglądarka / worker / Node): normalizacja wejścia,
                      dokładna arytmetyka, komendy CAS, nierówności, układy, numeryka, renderer LaTeX→HTML
  cas-bridge.js     — mostek do workera z timeoutem 10 s i fallbackiem synchronicznym (np. file://)
  cas-worker.js     — Web Worker liczący CAS poza wątkiem UI (ochrona przed zawieszeniem)
  calculator.js     — zakładka KALKULATOR: klawiatura 4-paneLOWa, historia, DEG/RAD, s⇔D
  graph.js          — zakładka WYKRESY: canvas, pan/zoom/trace, analizy, tabela wartości
  matrix.js         — zakładka MACIERZE: det, odwrotność, A·X=B, wartości/wektory własne, wektory
  stats.js          — zakładka STATYSTYKA: opisowa, regresje, rozkłady, kombinatoryka, histogram
tests/run-tests.js  — 81 testów silnika (Node): node tests/run-tests.js
sw.js               — cache PWA v8 (wszystkie nowe pliki offline)
```

Silnik `engine.js` nie korzysta z DOM ani localStorage — testowalny w Node, współdzielony
przez wątek główny i workera.

## Funkcje KALKULATORA (zakładka)

- Dokładne wyniki: ułamki (`1/3+1/6 = 1/2`), pierwiastki (`√2`), `π`, `i`; przełącznik s⇔D.
- Tryb DEG/RAD (symboliczne wyniki zawsze w radianach — jak w CAS).
- Liczby zespolone: `(1+2i)(2−i)`, `sqrt(−4)`.
- Historia (localStorage), klik wstawia wynik do pola, `ans` = ostatni wynik.
- Przypisania: `x = 5`, definicje funkcji: `f(x) = x^2-3*x+2` (dostępne na wykresach).
- Podgląd wyrażenia w zapisie naturalnym (ułamki piętrowe, pierwiastki, potęgi).
- Klawiatura: 123 / f(x) / CAS / abc; obsługa klawiatury fizycznej (Enter = EXE, ↑ = historia).

### Komendy CAS (pomoc klawiatury CAS)

| Komenda | Przykład |
|---|---|
| `solve(równanie, x)` | `solve(x^2-2*x-3=0, x)` → x = 3, x = −1 |
| układy | `solve([x+y=10, x-y=4], [x, y])` — liniowe (dokładne ułamki) i 2 równania nieliniowe |
| `nsolve(f=0, x, start)` | rozwiązania numeryczne (Newton + skan) |
| nierówności | `solve(x^2-9>0, x)` → przedziały z notacją ( )/[ ] |
| `diff(f, x[, n])` | pochodne, także cząstkowe i wyższych rzędów |
| `integrate(f, x[, a, b])` | całki oznaczone dokładnie + numerycznie (Simpson) |
| `limit(f, x, a)` | granice symboliczne i numeryczne, jednostronne, w `inf` |
| `sum(f, k, a, b)` / `prod(...)` | sumy i iloczyny (dokładne do 2000 wyrazów) |
| `expand / factor / simplify` | przekształcenia wyrażeń |
| `taylor(f, x, a, n)` | wielomian Taylora |
| `gcd, lcm, mod, combinations, permutations, factorial` | teoria liczb, kombinatoryka |

Równania trygonometryczne zwracają rozwiązania parametryczne (n ∈ ℤ).
Nierówności trygonometryczne analizowane w oknie [−3π, 3π] z notką o okresowości.

## WYKRESY

- y = f(x) (do 6 funkcji), krzywe parametryczne x(t), y(t) i biegunowe r(θ).
- Przesuwanie (drag), zoom (kółko / szczypnięcie / przyciski), śledzenie punktu (trace).
- Analizy: miejsca zerowe, ekstrema (min/max z współrzędnymi), punkty przecięcia,
  całka oznaczona z polem pod krzywą.
- Tabela wartości (x od/do/krok), funkcje użytkownika z KALKULATORA są dostępne.
- Tryb DEG wpływa na rysowanie funkcji trygonometrycznych.

## MACIERZE

Edytowalne A i B (1×1 … 6×6): A+B, A−B, A·B, det, A⁻¹, Aᵀ, rząd, Aᵏ, układ A·X=B,
wartości własne i wektory własne (także zespolone). Wektory: a·b, a×b (3D), |a|, kąt.

## STATYSTYKA

- Opisowa: n, Σ, średnia, mediana, dominanty, min/max, rozstęp, Q1/Q3, IQR,
  wariancja i odchylenie (populacyjne i próbki), Σx²; histogram.
- Regresje: liniowa, kwadratowa, sześcienna, wykładnicza, logarytmiczna, potęgowa —
  wzór, r (dla liniowej), R², prognoza.
- Rozkłady: normalny P(X<x), dwumianowy P(X=k) i P(X≤k), Poissona.
- Kombinatoryka: n!, nPk, nCk — dokładnie (BigInt, n ≤ 500).

## Ograniczenia względem Casio ClassPad II FX-CP400

- Brak równań różniczkowych, macierzy symbolicznych i zespolonych w CAS (nerdamer liczbowe).
- Nierówności: analiza numeryczna w oknie (±100 lub ±3π), nie pełna analiza symboliczna.
- Rysowanie 2D (bez 3D Graph, geometrii, arkusza kalkulacyjnego, eActivity).
- Zapis wejścia liniowy z podglądem (bez edycji 2D „na miejscu").
- Ułamki dziesiętne wpisujemy z kropką (przecinek konwertowany heurystycznie poza funkcjami).

## Testy

```
node tests/run-tests.js   # 81 testów: arytmetyka dokładna, CAS, układy, nierówności,
                          # numeryka, DEG/RAD, zespolone, macierze, formatowanie, błędy
```
