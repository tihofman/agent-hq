# 16-Bit Pixel-Art Assets: Agent-HQ

Dieses Verzeichnis enthält alle visuellen 16-Bit Pixel-Art Assets für das Virtual Office von **Agent-HQ** (Charakter-Spritesheets und Tileset).

---

## 1. Farbpalette: Endesga 32 (EDG32)

Alle Assets basieren strikt auf der einheitlichen **Endesga 32 (EDG32)** Palette von [Ed Blankenship (ENDESGA)](https://lospec.com/palette-list/endesga-32), einer der renommiertesten und harmonischsten 32-Farben-Paletten für 16-Bit Pixel-Art (SNES / Mega-Drive-Ästhetik).

| Index  | Hex-Code  | Farb-Bezeichnung              | Primäre Verwendung                            |
| :----: | :-------- | :---------------------------- | :-------------------------------------------- |
| **0**  | `#be4a2f` | Terracotta / Rostrot          | Ziegelwand, Blumentopf, Schatten              |
| **1**  | `#d77643` | Warmes Kupfer / Holz          | Parkett, Holztische, Terracotta-Fliesen       |
| **2**  | `#ead4aa` | Sand / Pergament / Helle Haut | Papierdokumente, Hauttöne, Fenster-Details    |
| **3**  | `#e4a672` | Pfirsich / Haut-Mittelton     | Gesicht, Hände, Holz-Highlights               |
| **4**  | `#b86f50` | Kastanienbraun / Holz dunkel  | Möbel, Schreibtische, Klemmbrett, Haare       |
| **5**  | `#733e39` | Russet / Tiefes Holz          | Bücherregal, Schatten, Ziegelmauer            |
| **6**  | `#3e2731` | Dunkle Schokolade             | Schattierungen, Haarkonturen                  |
| **7**  | `#a22633` | Karminrot                     | Claudes Krawatte, Akzente                     |
| **8**  | `#e43b44` | Helles Rot                    | Krawatten-Highlights, Alarm-LEDs              |
| **9**  | `#f77622` | Warmes Orange                 | Energy-Drink, Warnungen                       |
| **10** | `#feae34` | Bernsteingold                 | Ticket-Mappe (Handover), Sticky Notes         |
| **11** | `#fee761` | Zitronengelb                  | Post-Its, Zzz-Schlafpartikel, Monitor-Glow    |
| **12** | `#63c74d` | Matrix-Hellgrün               | Terminal-Code, CI-Checkmarks, Pflanzenblätter |
| **13** | `#3e8948` | Wiesengrün                    | Pflanzen-Mittelton                            |
| **14** | `#265c42` | Tannengrün                    | Tiefe Schatten in Pflanzen, Couch             |
| **15** | `#193c3e` | Dunkeltürkis                  | Couch, Server-Gehäuse, Cyberwear              |
| **16** | `#124e89` | Königsblau / Navy             | Claudes Anzug, Schlafmütze, Hallen-Teppich    |
| **17** | `#0099db` | Himmelblau                    | Wasserspender, LEDs, Himmel im Fenster        |
| **18** | `#2ce8f5` | Cyan-Neon                     | Codex-Brille, Terminal-Glow, Glaswände        |
| **19** | `#ffffff` | Reinweiß                      | Hemdkragen, Notizen, Turnschuhe, Highlights   |
| **20** | `#c0cbdc` | Silber-Grau                   | Whiteboard, Kaffeemaschine, Metallschienen    |
| **21** | `#8b9bb4` | Stahl-Graublau                | Aktenschrank, Uhrenrand, Regalschatten        |
| **22** | `#5a6988` | Schiefergrau                  | Bürostuhl-Mesh, Tower-Gehäuse                 |
| **23** | `#3a4466` | Tiefes Schiefer               | Hosen, Computertower, dunkler Teppich         |
| **24** | `#262b44` | Mitternachtsblau              | Anzug-Schatten, Terminal-Screens              |
| **25** | `#181425` | Tiefschwarz (Night)           | Pixel-Outlines, Schatten am Boden             |
| **26** | `#ff0044` | Neon-Pink                     | RGB-Beleuchtung, Fehler-LEDs                  |
| **27** | `#68386c` | Aubergine / Dunkelviolett     | agy Hoodie-Schatten                           |
| **28** | `#b55088` | Orchideen-Violett             | agy Signature-Hoodie                          |
| **29** | `#f6757a` | Korallenrosa                  | Sticky Notes, Donut-Glasur                    |
| **30** | `#e8b796` | Warmer Hautton                | Gesichts-Highlights                           |
| **31** | `#c28569` | Lederbraun / Tan              | Lederakzente, Haare                           |

---

## 2. Charakter-Spritesheets (`sprites/`)

Jedes Spritesheet hat eine einheitliche Frame-Größe von **128×128 Pixeln** (angeordnet in 8 Spalten × 4 Reihen = 1024×512 Pixel).

### Verfügbare Charaktere:

- **`claude.png` / `claude.json`**: CEO & Lead Architect. Eleganter anthrazit/blauer Anzug, weißer Kragen, rote Krawatte, distinguierte Haarpracht & Bart, Klemmbrett.
- **`agy.png` / `agy.json`**: Core Developer. Lässiger violetter Hoodie mit weißen Kordeln, Sneakers, mechanische Tastatur, Energy-Drink.
- **`codex.png` / `codex.json`**: Algorithm Specialist & Reviewer. High-Tech Turtleneck mit Cyber-Grün/Cyan-Akzenten, rechteckige Brille mit Terminal-Glow.

### Animationen & Frame-Indizes pro Charakter:

| Animation        | Frame-Indizes    | Anzahl | FPS / Loop  | Beschreibung                                                |
| :--------------- | :--------------- | :----: | :---------: | :---------------------------------------------------------- |
| **`idle`**       | `0, 1, 2, 3`     |   4    |  4 / loop   | Subtiles Wippen, Atmen und Blinzeln                         |
| **`walk_down`**  | `4, 5, 6, 7`     |   4    |  6 / loop   | 4-Richtungs-Walkcycle nach vorne / Süden                    |
| **`walk_left`**  | `8, 9, 10, 11`   |   4    |  6 / loop   | Walkcycle nach links / Westen                               |
| **`walk_right`** | `12, 13, 14, 15` |   4    |  6 / loop   | Walkcycle nach rechts / Osten                               |
| **`walk_up`**    | `16, 17, 18, 19` |   4    |  6 / loop   | Walkcycle nach hinten / Norden                              |
| **`typing`**     | `20, 21, 22`     |   3    |  5 / loop   | Hacken auf mechanischer Tastatur mit Bildschirmflimmern     |
| **`handover`**   | `23, 24`         |   2    | 3 / no loop | Übergabe der gelben Ticket-Akte bei Task-Delegation         |
| **`review`**     | `25, 26`         |   2    |  3 / loop   | Prüfen von Akzeptanzkriterien mit Klemmbrett & grünem Haken |
| **`cooldown`**   | `27, 28`         |   2    |  2 / loop   | Schlafen mit klassischer Schlafmütze & schwebendem Zzz      |
| **`alert`**      | `30`             |   1    | 1 / no loop | Alarm-Ausrufezeichen über Kopf bei Task-Fehler              |
| **`success`**    | `31`             |   1    | 1 / no loop | Siegerpose / Thumbs-up bei PR-Merge                         |

---

## 3. Office-Tileset (`tilesets/`)

Das Tileset **`office_tiles.png`** liegt im Format **1024×1024 Pixel** vor (8 Spalten × 8 Reihen = 64 Tiles à **128×128 Pixel**).

### Übersicht der Tile-Kategorien:

- **Böden (`floor`)**: Helles Eichenparkett (0), dunkles Walnussparkett (1), Dev-Teppich (2), Flur-Läufer (3), Lounge-Keramikfliesen (4), Server-Doppelboden (5), Übergangsleisten (6), Fußmatte (7), Kabelbrücke (50).
- **Wände (`wall`)**: Deckenabschluss/Stuckleiste (8), Trockenbauwand (9), Fußleiste (10), Klinker/Ziegel-Akzentwand (11), Glaswand oben (12), Glaswand unten (13), Innenecke (14), Außenecke (15).
- **Schreibtische (`desk`)**: Schreibtisch links mit Schubladen (16), Schreibtisch Mitte (17), Schreibtisch rechts (18), Dev-Desk mit Dual-Monitoren und Syntax-Code (19), Laptop & Kaffeetasse (20).
- **Möbel & Regale (`furniture`)**: Ergonomischer Bürostuhl Front (21), Bürostuhl Rückseite (22), Bücherregal oben mit Fachbüchern (28), Bücherregal unten mit Ordnern (29), Metall-Aktenschrank (30), Couch-Tisch (35), Runder Konferenztisch (52–55).
- **Whiteboard (`whiteboard`)**: 2×2 Architektur-Whiteboard (Tiles 24, 25, 26, 27) mit Systemdiagrammen, Kanban-Post-Its, Stiftablage und Schwamm.
- **Lounge-Couch (`couch`)**: 3-teiliges modulares Sofa (Tiles 32, 33, 34) mit Armlehnen und Zierkissen.
- **Kaffee & Küche (`kitchen`)**: Siebträger-Espressomaschine auf Theke (36), Küchenunterschrank (37), Wasserspender mit blauem Ballon (38), Getränkekühlschrank (47).
- **Pflanzen (`plant`)**: Große Monstera im Terracotta-Topf (39), Schreibtisch-Sukkulente (44).
- **Server & QA (`server`, `qa`)**: 42U Server-Rack mit Patchfeldern und Blink-LEDs (40, 41), CI/CD Dashboard-Screen mit 100% Pass und Checkmarks (42, 43).
- **Türen & Fenster (`door`, `window`)**: Glastür-Sturz (48), Türschwelle (49), Tageslicht-Skyline (60), Nacht-Skyline (61).
- **Dekoration & Props (`props`, `tech`)**: Papierkorb (31), Wanduhr (45), Blaupause (46), Wegweiser (51), Pizza-Karton (56), Donut-Box (57), Retro-CRT (58), Pokal (59), beleuchtetes Notausgangs-Schild (62).

---

## 4. Neu-Generieren & Reproduzierbarkeit

Alle Grafiken werden zu 100 % deterministisch durch ein Node.js-Skript aus der Farbpalette generiert:

```bash
# Ausführen des Generators
node tools/pixel-art/generate.js

# Oder via npm-Script:
npm run generate:assets
```

---

## 5. Lizenz & Urheberrecht

- **Grafiken**: Selbst erstellt (prozedural generiert via `tools/pixel-art/generate.js`). Lizenziert unter **MIT** wie das Repository.
- **Farbpalette**: [Endesga 32 (EDG32)](https://lospec.com/palette-list/endesga-32) von Ed Blankenship (ENDESGA), CC0 / Public Domain.
