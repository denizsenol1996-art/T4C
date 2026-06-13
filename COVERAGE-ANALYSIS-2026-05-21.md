# Coverage-analyse 2026-05-21

Read-only analyse over `taxaties` (3517 rows) + `dealer_feedback` (654 cases met sold_price ground truth).

## Laag 1 — Volume map

- Totaal taxaties: **3517**
- **147** make×model combinaties dekken **80%** van het volume

### Top 20 makes (volume)

| Make | n | % |
|---|---|---|
| TOYOTA | 387 | 11.0% |
| MERCEDES-BENZ | 379 | 10.8% |
| VOLKSWAGEN | 326 | 9.3% |
| BMW | 286 | 8.1% |
| RENAULT | 281 | 8.0% |
| AUDI | 213 | 6.1% |
| KIA | 210 | 6.0% |
| OPEL | 195 | 5.5% |
| FORD | 142 | 4.0% |
| SEAT | 137 | 3.9% |
| NISSAN | 126 | 3.6% |
| HYUNDAI | 108 | 3.1% |
| VOLVO | 94 | 2.7% |
| PEUGEOT | 73 | 2.1% |
| MAZDA | 66 | 1.9% |
| CITROEN | 64 | 1.8% |
| SKODA | 64 | 1.8% |
| MITSUBISHI | 52 | 1.5% |
| FIAT | 41 | 1.2% |
| SUZUKI | 40 | 1.1% |

### Top 30 make × model

| Make | Model | n | cumul % |
|---|---|---|---|
| VOLKSWAGEN | GOLF | 139 | 4.0% |
| MERCEDES-BENZ | E 350 CGI | 129 | 7.6% |
| TOYOTA | AYGO | 111 | 10.8% |
| TOYOTA | PRIUS | 87 | 13.2% |
| SEAT | LEON | 83 | 15.6% |
| VOLKSWAGEN | POLO | 69 | 17.6% |
| NISSAN | QASHQAI | 69 | 19.5% |
| BMW | 320I | 62 | 21.3% |
| RENAULT | CAPTUR | 59 | 23.0% |
| AUDI | A3 | 58 | 24.6% |
| FORD | FIESTA | 54 | 26.2% |
| KIA | PICANTO | 51 | 27.6% |
| RENAULT | MEGANE | 47 | 28.9% |
| HYUNDAI | I20 | 45 | 30.2% |
| RENAULT | CLIO | 42 | 31.4% |
| KIA | NIRO | 42 | 32.6% |
| MERCEDES-BENZ | A 180 | 39 | 33.7% |
| BMW | 5ER REIHE | 36 | 34.7% |
| KIA | RIO | 34 | 35.7% |
| KIA | SPORTAGE | 32 | 36.6% |
| MITSUBISHI | OUTLANDER | 31 | 37.5% |
| FORD | FOCUS | 29 | 38.3% |
| TOYOTA | YARIS | 29 | 39.2% |
| AUDI | AUDI A3 | 28 | 39.9% |
| MAZDA | CX-5 | 27 | 40.7% |
| TOYOTA | AURIS | 26 | 41.5% |
| RENAULT | KADJAR | 25 | 42.2% |
| MERCEDES-BENZ | E-KLASSE | 25 | 42.9% |
| MG | ZS EV | 24 | 43.6% |
| RENAULT | TWINGO | 24 | 44.2% |

## Laag 2 — Accuracy-map

- Clusters met ≥10 feedback-cases: **11**
- Gerangschikt op `|median_delta - 1.0| × n` (aggregate bias × volume)

### Top 30 accuracy clusters (make × model)

| Make | Model | n | median Δ | IQR | bias | %zwaar | abs_impact |
|---|---|---|---|---|---|---|---|
| FORD | FIESTA | 10 | 0.636 | [0.49,0.85] | -0.364 | 60% | 3.64 |
| RENAULT | CAPTUR | 13 | 0.812 | [0.74,1.00] | -0.188 | 15% | 2.45 |
| MITSUBISHI | OUTLANDER | 11 | 0.813 | [0.61,0.86] | -0.187 | 27% | 2.06 |
| RENAULT | MEGANE | 10 | 0.824 | [0.72,1.00] | -0.176 | 20% | 1.76 |
| RENAULT | CLIO | 13 | 0.881 | [0.72,0.93] | -0.119 | 15% | 1.55 |
| KIA | SPORTAGE | 11 | 0.898 | [0.76,1.00] | -0.102 | 9% | 1.13 |
| TOYOTA | PRIUS | 10 | 1.084 | [0.89,1.23] | +0.084 | 20% | 0.84 |
| VOLKSWAGEN | GOLF | 16 | 0.952 | [0.81,1.16] | -0.048 | 25% | 0.76 |
| NISSAN | QASHQAI | 12 | 1.000 | [0.91,1.00] | +0.000 | 17% | 0.00 |
| VOLKSWAGEN | POLO | 18 | 1.000 | [0.72,1.27] | +0.000 | 39% | 0.00 |
| KIA | PICANTO | 11 | 1.000 | [0.84,1.19] | +0.000 | 9% | 0.00 |

### Per make (n≥5 feedback)

| Make | n | median Δ | IQR | %zwaar |
|---|---|---|---|---|
| RENAULT | 72 | 0.897 | [0.72,1.00] | 24% |
| TOYOTA | 66 | 1.020 | [0.90,1.22] | 27% |
| VOLKSWAGEN | 56 | 0.903 | [0.75,1.06] | 29% |
| KIA | 54 | 0.943 | [0.80,1.00] | 19% |
| MERCEDES-BENZ | 43 | 0.902 | [0.79,1.00] | 26% |
| OPEL | 42 | 0.798 | [0.63,0.90] | 36% |
| BMW | 36 | 1.000 | [0.82,1.00] | 17% |
| HYUNDAI | 28 | 0.871 | [0.60,0.98] | 32% |
| FORD | 28 | 0.607 | [0.46,0.93] | 64% |
| NISSAN | 27 | 0.911 | [0.64,1.00] | 37% |
| VOLVO | 21 | 0.813 | [0.71,1.00] | 19% |
| MITSUBISHI | 19 | 0.836 | [0.75,1.00] | 16% |
| PEUGEOT | 19 | 0.896 | [0.63,0.92] | 32% |
| SKODA | 18 | 0.917 | [0.72,1.04] | 22% |
| MAZDA | 16 | 1.027 | [0.92,1.13] | 6% |
| AUDI | 16 | 0.875 | [0.76,1.00] | 6% |
| CITROEN | 16 | 0.702 | [0.58,0.93] | 50% |
| SEAT | 14 | 0.948 | [0.76,1.08] | 36% |
| DACIA | 13 | 0.940 | [0.65,0.97] | 31% |
| FIAT | 10 | 0.860 | [0.48,0.91] | 40% |

## Laag 3 — Financial impact

- **Totaal overschot** (geld dealer zou verliezen): **€547,283**
- **Totaal misgelopen** (export/onderbieding): **€170,294**
- **Net** (over-minus-misgelopen): **€+376,989**
- Som absolute beweging op de markt (over alle clusters): €717,577

### Top 20 financial impact (geld op tafel, absoluut)

| Make | Model | n | overshoot (verlies) | missed (kans) | net | median Δ |
|---|---|---|---|---|---|---|
| VOLKSWAGEN | POLO | 18 | €8,005 | €11,277 | €-3,272 | 1.000 |
| MITSUBISHI | OUTLANDER | 11 | €15,600 | €539 | €+15,061 | 0.813 |
| RENAULT | CAPTUR | 13 | €13,707 | €728 | €+12,979 | 0.812 |
| KIA | NIRO | 8 | €2,042 | €11,226 | €-9,184 | 1.000 |
| VOLKSWAGEN | GOLF | 16 | €5,987 | €6,037 | €-50 | 0.952 |
| TOYOTA | YARIS | 9 | €4,383 | €6,977 | €-2,594 | 0.972 |
| RENAULT | CLIO | 13 | €9,179 | €1,139 | €+8,040 | 0.881 |
| HYUNDAI | I20 | 9 | €8,617 | €889 | €+7,728 | 0.851 |
| TOYOTA | COROLLA | 8 | €0 | €9,287 | €-9,287 | 1.059 |
| KIA | SPORTAGE | 11 | €6,563 | €2,519 | €+4,044 | 0.898 |
| FORD | FIESTA | 10 | €8,653 | €0 | €+8,653 | 0.636 |
| KIA | RIO | 9 | €5,681 | €2,900 | €+2,781 | 1.000 |
| TOYOTA | PRIUS | 10 | €1,402 | €6,177 | €-4,775 | 1.084 |
| CITROEN | C1 | 8 | €6,976 | €0 | €+6,976 | 0.626 |
| MAZDA | CX-5 | 7 | €1,481 | €5,386 | €-3,905 | 1.124 |
| KIA | PICANTO | 11 | €3,812 | €3,026 | €+786 | 1.000 |
| FIAT | 500 | 6 | €6,593 | €0 | €+6,593 | 0.862 |
| TOYOTA | C-HR | 7 | €0 | €6,526 | €-6,526 | 1.063 |
| NISSAN | QASHQAI | 12 | €4,341 | €2,028 | €+2,313 | 1.000 |
| RENAULT | TRAFIC | 6 | €4,313 | €2,039 | €+2,274 | 0.935 |

## Laag 4 — Trend laatste 6 maanden

Top-5 feedback-volume make×model clusters, mediaan delta per maand.

### VOLKSWAGEN GOLF

| Maand | n | median Δ |
|---|---|---|
| 2026-03 | 1 | 0.887 |
| 2026-04 | 8 | 0.807 |
| 2026-05 | 7 | 1.000 |

### MERCEDES-BENZ E 350 CGI

| Maand | n | median Δ |
|---|---|---|
| 2026-05 | 2 | 0.894 |

### TOYOTA AYGO

| Maand | n | median Δ |
|---|---|---|
| 2026-03 | 1 | 0.941 |
| 2026-04 | 1 | 0.794 |
| 2026-05 | 4 | 0.469 |

### TOYOTA PRIUS

| Maand | n | median Δ |
|---|---|---|
| 2026-03 | 1 | 1.101 |
| 2026-04 | 4 | 0.883 |
| 2026-05 | 5 | 1.089 |

### SEAT LEON

| Maand | n | median Δ |
|---|---|---|
| 2026-03 | 1 | 0.896 |
| 2026-04 | 1 | 1.279 |
| 2026-05 | 1 | 0.077 |

## Laag 5 — Coverage gap (market_count distributie)

Clusters waar comp-engine structureel te dun aanbod heeft. Expert-fallback moet daar het werk doen.

### Top 30 coverage gaps (gewogen op √n × thin%)

| Make | Model | n | thin% (<3 listings) | zero% (0 listings) |
|---|---|---|---|---|
| MERCEDES-BENZ | E 350 CGI | 129 | 68% | 67% |
| TOYOTA | AYGO | 111 | 66% | 66% |
| VOLKSWAGEN | GOLF | 139 | 57% | 53% |
| SEAT | LEON | 83 | 64% | 64% |
| AUDI | A3 | 58 | 71% | 71% |
| MERCEDES-BENZ | E-KLASSE | 25 | 100% | 100% |
| BMW | 320I | 62 | 61% | 58% |
| TOYOTA | PRIUS | 87 | 52% | 51% |
| BMW | 5-SERIE | 23 | 100% | 100% |
| NISSAN | QASHQAI | 69 | 57% | 49% |
| BMW | 5ER REIHE | 36 | 64% | 42% |
| MERCEDES-BENZ | E 350 | 13 | 100% | 100% |
| MERCEDES-BENZ | A-KLASSE | 12 | 100% | 100% |
| VOLKSWAGEN | POLO | 69 | 41% | 39% |
| RENAULT | CAPTUR | 59 | 42% | 27% |
| MERCEDES-BENZ | A 180 | 39 | 51% | 41% |
| MG | ZS EV | 24 | 58% | 58% |
| MAZDA | MAZDA3 | 16 | 69% | 69% |
| VOLVO | XC90 | 11 | 82% | 36% |
| AUDI | A1 | 11 | 82% | 82% |
| BMW | 3ER REIHE | 20 | 60% | 30% |
| KIA | PICANTO | 51 | 37% | 37% |
| KIA | NIRO | 42 | 40% | 33% |
| TOYOTA | VERSO-S | 12 | 75% | 50% |
| FORD | FIESTA | 54 | 35% | 28% |
| KIA | RIO | 34 | 44% | 44% |
| BMW | 535I | 10 | 80% | 80% |
| SEAT | IBIZA | 22 | 50% | 50% |
| RENAULT | CLIO | 42 | 36% | 29% |
| BMW | 316D | 12 | 67% | 67% |

## Top 20 priority-clusters (gecombineerd)

Geselecteerd op absolute financial impact (overshoot + missed). Per cluster: volume in taxaties, feedback-accuracy, coverage-gap, voorgestelde actie.

| # | Make | Model | feedback n | median Δ | bias | overshoot | missed | thin% | voorgestelde actie |
|---|---|---|---|---|---|---|---|---|---|
| 1 | VOLKSWAGEN | POLO | 18 | 1.000 | +0.000 | €8,005 | €11,277 | 41% | ok — geen actie nodig |
| 2 | MITSUBISHI | OUTLANDER | 11 | 0.813 | -0.187 | €15,600 | €539 | 19% | review (matig) |
| 3 | RENAULT | CAPTUR | 13 | 0.812 | -0.188 | €13,707 | €728 | 42% | review (matig) |
| 4 | KIA | NIRO | 8 | 1.000 | +0.000 | €2,042 | €11,226 | 40% | ok — geen actie nodig |
| 5 | VOLKSWAGEN | GOLF | 16 | 0.952 | -0.048 | €5,987 | €6,037 | 57% | expert-fallback (data-pool te dun) |
| 6 | TOYOTA | YARIS | 9 | 0.972 | -0.028 | €4,383 | €6,977 | 21% | ok — geen actie nodig |
| 7 | RENAULT | CLIO | 13 | 0.881 | -0.119 | €9,179 | €1,139 | 36% | review (matig) |
| 8 | HYUNDAI | I20 | 9 | 0.851 | -0.149 | €8,617 | €889 | 20% | review (matig) |
| 9 | TOYOTA | COROLLA | 8 | 1.059 | +0.059 | €0 | €9,287 | 32% | ok — geen actie nodig |
| 10 | KIA | SPORTAGE | 11 | 0.898 | -0.102 | €6,563 | €2,519 | 31% | review (matig) |
| 11 | FORD | FIESTA | 10 | 0.636 | -0.364 | €8,653 | €0 | 35% | multiplier (-) of data-pool fix (systemic overshoot) |
| 12 | KIA | RIO | 9 | 1.000 | +0.000 | €5,681 | €2,900 | 44% | ok — geen actie nodig |
| 13 | TOYOTA | PRIUS | 10 | 1.084 | +0.084 | €1,402 | €6,177 | 52% | expert-fallback (data-pool te dun) |
| 14 | CITROEN | C1 | 8 | 0.626 | -0.374 | €6,976 | €0 | 28% | multiplier (-) of data-pool fix (systemic overshoot) |
| 15 | MAZDA | CX-5 | 7 | 1.124 | +0.124 | €1,481 | €5,386 | 26% | review (matig) |
| 16 | KIA | PICANTO | 11 | 1.000 | +0.000 | €3,812 | €3,026 | 37% | ok — geen actie nodig |
| 17 | FIAT | 500 | 6 | 0.862 | -0.138 | €6,593 | €0 | 32% | review (matig) |
| 18 | TOYOTA | C-HR | 7 | 1.063 | +0.063 | €0 | €6,526 | 21% | ok — geen actie nodig |
| 19 | NISSAN | QASHQAI | 12 | 1.000 | +0.000 | €4,341 | €2,028 | 57% | expert-fallback (data-pool te dun) |
| 20 | RENAULT | TRAFIC | 6 | 0.935 | -0.065 | €4,313 | €2,039 | 36% | ok — geen actie nodig |
