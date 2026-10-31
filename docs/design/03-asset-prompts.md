# 03 · Ассеты и промпты для генерации

Полный список изображений, которые нужно сгенерировать, с именами файлов, размерами, назначением и промптами. Где и как каждый ассет используется, описано в [02-spec-and-plan.md](02-spec-and-plan.md). Почему без них интерфейс выглядит как MVP — в [01-audit.md](01-audit.md), R1.

Промпты на английском: генераторы изображений понимают его лучше. Всё остальное на русском.

**Объём:** ~108 изображений в 11 группах (A–K). Порядок генерации по приоритету — §4.

---

## 0. Как пользоваться

1. К каждому промпту добавлять **House style** из §1.2 и **Negative** из §1.3. Исключение — группы с пометкой «свой стиль».
2. Генерировать в размере из колонки «Ген.». Экспортировать скриптом из §2 в итоговые размеры.
3. Проверять каждую картинку по чек-листу §2.4 до того, как класть в `public/assets/`.
4. Имена файлов — точно как в таблицах: на них ссылается манифест и код.

---

## 1. Общие правила

### 1.1 Права (обязательно)
- **Никаких лиц реальных людей.** Пилоты — только шлем с опущенным тонированным визором или силуэт со спины.
- **Никаких логотипов и товарных знаков:** F1 и Formula 1, FIA, команды (Ferrari, McLaren, Red Bull, Mercedes и т. д.), спонсоры (Rolex, Pirelli, DHL, Aramco и т. д.), производители. Ливреи передаём только **цветом и формой полос**.
- **Никаких настоящих номеров и надписей на машинах.** Номер пилота рисуется в UI поверх картинки.
- **Никакого текста в изображениях** вообще: буквы генератор пишет с ошибками, а интерфейс двуязычный.
- Узнаваемые места передаём **атмосферой и формой** (гавань, колесо обозрения, мост, отель с сеткой), без вывесок и брендов.

### 1.2 House style (добавлять к каждому промпту)
```
Cinematic motorsport night photography look, premium sports-app key art. Deep near-black
shadows (#07090b), cool blue-teal ambient, crisp rim light in electric lime (#c6ff3d) and
cyan (#2fe6ff) from stadium floodlights, subtle haze and light bloom, wet-asphalt reflections
where surfaces allow, high micro-contrast, realistic materials, shallow depth of field,
35mm lens feel, ultra-detailed, clean composition with generous dark negative space.
```

### 1.3 Negative (добавлять к каждому промпту)
```
text, letters, numbers, watermark, signature, logo, brand name, sponsor decals, team logos,
F1 logo, human face, visible face, portrait, cartoon, anime, flat vector, low poly, plastic
toy look, oversaturated rainbow colors, purple-pink gradients, lens flare overload, blurry,
jpeg artifacts, deformed wheels, extra wheels, distorted car proportions, people in foreground
```

### 1.4 Палитра (для «своего стиля» и проверки)
Фон `#07090b` · панель `#10161a` · лайм `#c6ff3d` · циан `#2fe6ff` · фиолетовый `#b26bff` · жёлтый `#ffd12e` · красный `#ff3b47`. В изображениях лайм и циан — только как **свет**, не как цвет больших заливок.

---

## 2. Технический конвейер

### 2.1 Прозрачный фон
- Если генератор поддерживает прозрачность (например, `gpt-image-1` с `background: "transparent"`, `output_format: "png"`), использовать её.
- Иначе генерировать на ровном фоне `#7f7f7f` (добавить к промпту: *isolated on a flat neutral mid-grey (#7f7f7f) studio background, soft contact shadow only*) и вырезать через `rembg` (`pip install rembg` → `rembg i in.png out.png`) или `@imgly/background-removal-node`. Ореол по краю убрать на 1–2 px.

### 2.2 Экспорт (скрипт `scripts/build-assets.mjs` на `sharp`, создать в фазе 0)
- Вход: `assets-src/<group>/<name>.png`. Выход: `public/assets/<group>/<name>-<w>.{avif,webp}` и манифест `src/assets/manifest.ts` (`w`, `h`, `dominant`, список ширин).
- Плиты (B, F, G, J, K): ширины **390 / 780 / 1170**. AVIF q50, WebP q72. Цель для ширины 1170 — ≤ 140 КБ AVIF.
- Объекты, шлемы, болиды и значки (C, D, E, H): ширины **96 / 192 / 288** (болиды **390 / 780**), только прозрачные WebP q80 и AVIF q55. Цель ≤ 25 КБ на 192.
- Текстуры (I): одна WebP 512×512, бесшовная.
- `dominant`: средний цвет картинки, для плейсхолдера.

### 2.3 Маски контуров трасс (только для варианта B из 02, §7.2)
Скрипт `dev/export-circuit-masks.mjs`: из `src/data/circuits/generated/meta.json` (`svgPath`, viewBox 0 0 100 100) отрисовать через Playwright белую линию толщиной 2.5 на чёрном фоне 1024×1024 → `assets-src/masks/<id>.png`. Маску подавать в ControlNet (lineart/canny, weight 0.6–0.8) или как image-prompt. В варианте A маски не нужны.

### 2.4 Чек-лист приёмки каждой картинки
- [ ] Нет текста, логотипов, лиц.
- [ ] Свет совпадает с house style: ключ сверху-слева, контровой лайм или циан.
- [ ] Для плит: левые 45 % (или нижние 40 % для вертикальных) тёмные и спокойные, иначе текст поверх не читается. Проверить контраст белого текста 15 px ≥ 4.5:1 поверх scrim.
- [ ] Для объектов: силуэт читается на 48 px; края чистые, без серого ореола.
- [ ] Серия однородна: положить 6 картинок группы рядом, ни одна не выбивается по свету, цвету и ракурсу.

---

## 3. Список ассетов

### A. Бренд

| ID | Файл | Ген. | Фон | Где | Промпт |
|---|---|---|---|---|---|
| A1 | `brand/logo-lockup.svg` | — | — | Шапка | **Не генерировать.** Сделать вручную в SVG: пульс-линия (как `LogoPulse` в `src/ui/icons.tsx`) и слово «PULSE ARENA» в Exo 2 Black Italic, «ARENA» лаймом. Варианты: горизонтальный и компактный (только знак) |
| A2 | `brand/app-icon.png` | 1024² | непрозрачный | Иконка бота и favicon | *свой стиль:* `App icon, a bold stylized heartbeat pulse line forming the silhouette of a race track chicane, electric lime (#c6ff3d) glowing line on deep near-black (#07090b) rounded square, subtle carbon fibre texture, soft inner glow, centered, minimal, premium, no text` |

### B. Плиты трасс — 24 шт. (вариант A: окружение без видимой трассы)

**Где:** hero «Сейчас в эфире» на главной, карточка «Этот уикенд», hero этапа, hero трассы, пулы `zone`, `position`, `pit`, режим «2D-арт» в эфире. Поверх кладётся неоновая SVG-трасса (02, §7.1).
**Ген.:** 1536×1024 (3:2). **Файл:** `plates/circuit-<id>.png`.

**Шаблон промпта:**
```
High aerial view at blue hour / night of {SETTING}, {LANDMARKS}. The race circuit itself is
NOT visible — the centre-left of the frame is calm, dark terrain and soft shadow (space for
an overlaid track graphic). City and venue lights glow at the edges; distant floodlights cast
lime and cyan rim light; light haze. Oblique 35° aerial angle, wide, atmospheric, cinematic.
```

| ID | Трасса | {SETTING} | {LANDMARKS} |
|---|---|---|---|
| B01 | `au-1953` Albert Park | a lakeside city park in Melbourne | a calm lake reflecting a downtown skyline, palm-lined paths, distant high-rises |
| B02 | `cn-2004` Shanghai | a vast modern motorsport complex near Shanghai | two wing-shaped grandstand canopies over a straight, flat surroundings, distant city glow |
| B03 | `jp-1962` Suzuka | a wooded hillside venue in Japan | a large illuminated Ferris wheel, amusement park, cedar forest, paddy fields in the distance |
| B04 | `bh-2002` Bahrain | a desert circuit at night | floodlit sand, a tall tower with a sail-like roof, endless dark desert, warm sodium-light pools |
| B05 | `sa-2021` Jeddah | a seaside corniche at night | dark Red Sea water, a long waterfront promenade with lights, modern towers, floodlit concrete walls |
| B06 | `us-2022` Miami | a stadium district in Miami | a huge illuminated football stadium, palm trees, a marina with yachts, warm humid night haze |
| B07 | `ca-1978` Montréal | a narrow river island park | dark river on both sides, a distant illuminated city skyline, a large geodesic sphere, a rowing basin |
| B08 | `mc-1929` Monaco | a steep harbour city on the Mediterranean | a harbour packed with lit superyachts, terraced buildings on cliffs, a casino square, sea reflections |
| B09 | `es-1991` Barcelona | rolling Catalan hills | a hillside grandstand, scattered industrial lights, Mediterranean pines, distant mountain silhouette |
| B10 | `at-1969` Red Bull Ring | an alpine valley venue | steep green mountains, a modern pit building with a curved wave-shaped roof, alpine meadows, cold clear night |
| B11 | `gb-1948` Silverstone | a former airfield in English countryside | flat fields, a wing-shaped pit building roof, light drizzle haze, hedgerows |
| B12 | `be-1925` Spa | a forest valley in the Ardennes | dense dark pine forest, mist in the valley, a steep uphill section silhouette, rain-wet trees |
| B13 | `hu-1986` Hungaroring | a dusty valley near Budapest | rolling hills with dry grass, distant village lights, warm summer night |
| B14 | `nl-1948` Zandvoort | coastal sand dunes by the North Sea | windswept dunes, beach, a seaside town with lights, steep banked hill silhouette |
| B15 | `it-1922` Monza | a royal park forest | tall old trees, the silhouette of an old banked oval ruin, misty lawns, warm lamps |
| B16 | `es-2026` Madring | a modern trade-fair district in Madrid | large exhibition halls with glass roofs, wide boulevards, modern city lights |
| B17 | `az-2016` Baku | a Caspian seafront capital | an ancient walled old city, three flame-shaped glass skyscrapers glowing, a seaside boulevard |
| B18 | `sg-2008` Marina Bay | a tropical waterfront city at night | a hotel of three towers joined by a sky-deck, a giant observation wheel, a bay full of reflections |
| B19 | `us-2012` COTA | Texas hill country | a tall red observation tower silhouette with lights, a big grandstand, dry grassland |
| B20 | `mx-1962` Mexico City | a city sports park | a baseball stadium bowl integrated into the venue, dense city lights, high-altitude clear air |
| B21 | `br-1940` Interlagos | a hilly São Paulo district | a dense city around a bowl-shaped valley, lakes, favela lights on hills, humid haze |
| B22 | `us-2023` Las Vegas | the Las Vegas strip at night | casino towers, a giant glowing sphere arena, neon reflections, desert mountains far away |
| B23 | `qa-2004` Lusail | a desert circuit near Doha | floodlit desert, a modern city skyline on the horizon, very bright floodlight towers |
| B24 | `ae-2009` Yas Marina | a marina at dusk in Abu Dhabi | a hotel covered in a glowing lattice canopy, a marina with yachts, a theme-park red roof in distance |

> **Вариант B (с трассой).** В шаблоне заменить вторую фразу на *«the race circuit is clearly visible as a dark asphalt ribbon following the provided outline, with lime and cyan glowing kerbs»* и подать маску из §2.3. Потом сделать калибровку `art.json` (02, §7.2).

### C. Болиды по командам — 11 шт. (прозрачный фон)

**Где:** hero пула «Дуэль» (две машины лицом друг к другу: одна зеркальная), экран пилота, featured в эфире. **Ген.:** 1536×1024. **Файл:** `cars/car-<team>.png`.

**Шаблон:**
```
A 2026-regulation open-wheel single-seater race car, rear three-quarter view from slightly
above, facing left, low and wide, halo cockpit protection, large rear wing, exposed wheels with
slick tyres. Generic livery in {COLORS}, painted as clean bold stripes and blocks, no logos,
no sponsor decals, no numbers. Studio-isolated, soft contact shadow, rim light lime from the
right, premium product render.
```

| ID | Файл | {COLORS} |
|---|---|---|
| C01 | `car-mclaren` | papaya orange (#FF8000) body with black (#1B1B1F) sidepods and light blue (#47C7FC) accents |
| C02 | `car-ferrari` | deep red (#D40019) body with white (#FFFFFF) stripes and yellow (#FFD100) accents |
| C03 | `car-redbull` | dark navy (#1A2B5C) matte body with red (#E10600) and yellow (#FFC906) accents |
| C04 | `car-mercedes` | silver (#C8CCCE) and black (#0B0B0D) split body with teal (#00D2BE) accents |
| C05 | `car-astonmartin` | racing green (#00594F) body with dark green (#0E2A26) and lime-yellow (#CEDC00) accents |
| C06 | `car-alpine` | blue (#0A62C9) body with pink (#FF87BC) and white accents |
| C07 | `car-williams` | dark navy (#0B2B66) body with bright blue (#1868DB) and sky blue (#64C4FF) accents |
| C08 | `car-racingbulls` | white (#F2F4F8) body with royal blue (#1634CC) and red (#E8112D) accents |
| C09 | `car-haas` | white (#F4F4F4) body with black (#1A1A1A) and red (#E10600) accents |
| C10 | `car-audi` | titanium grey (#8E9196) body with black (#151515) and red (#F50537) accents |
| C11 | `car-cadillac` | gloss black (#0D0D0F) body with white (#F2F2F2) and gold (#C9A227) accents |

### D. Шлемы по командам — 11 шт. (прозрачный фон)

**Где:** аватар (шапка, профиль), рейтинг, полоса тайминга, карточки пилотов в пулах, подиум результатов. Номер пилота рисует UI. **Ген.:** 1024². **Файл:** `helmets/helmet-<team>.png`.

**Шаблон:**
```
A modern closed-face racing helmet, three-quarter front view facing right, visor fully down
and dark mirrored (no face visible), aerodynamic top spoiler. Paint design in {COLORS} with
sweeping stripes, glossy clear coat with reflections, no logos, no text, no numbers.
Studio-isolated, soft shadow, lime rim light from the right edge.
```
{COLORS} — та же колонка, что в группе C (D01 `helmet-mclaren` … D11 `helmet-cadillac`). Дополнительно: **D12 `helmet-guest`** — *matte graphite grey with a single thin lime (#c6ff3d) stripe*.

### E. Объекты — 22 шт. (прозрачный фон)

**Где:** плитки исходов, тикет, баннеры моментов эфира, награды, кошелёк, рейтинг. **Ген.:** 1024², объект занимает ~80 % кадра. **Файл:** `objects/<id>.png`.

**Общая приписка к каждому объекту:** `Single object, centered, three-quarter view, isolated, premium 3D render, studio lighting with lime rim light, consistent with a set of game-UI collectible icons.`

| ID | Файл | Промпт |
|---|---|---|
| E01 | `tyre-soft` | A single racing slick tyre standing upright, black rubber, bright red (#E8002D) sidewall band, the large letter-shaped marking replaced by a plain coloured ring (no text) |
| E02 | `tyre-medium` | Same tyre, yellow (#FFD12E) sidewall band |
| E03 | `tyre-hard` | Same tyre, white (#F0F0EC) sidewall band |
| E04 | `tyre-inter` | Same tyre with shallow grooved tread, green (#43B02A) sidewall band |
| E05 | `tyre-wet` | Same tyre with deep grooved tread, blue (#0067AD) sidewall band, water droplets |
| E06 | `flag-yellow` | A waving marshal flag on a short black pole, bright yellow fabric with realistic folds |
| E07 | `flag-red` | Same flag, bright red fabric |
| E08 | `flag-green` | Same flag, bright green fabric |
| E09 | `flag-chequered` | Same flag, black-and-white chequered fabric |
| E10 | `flag-blue` | Same flag, blue fabric with a diagonal lighter stripe |
| E11 | `safety-car` | A modern high-performance sports coupe used as a safety car, front three-quarter view, dark grey paint, an amber light bar on the roof glowing, no logos, no text |
| E12 | `vsc-board` | A trackside LED marshal panel glowing amber with an abstract warning chevron pattern (no letters), mounted on a small post |
| E13 | `stopwatch` | A sleek metal sports stopwatch with a lime glowing dial ring, no numbers on the dial |
| E14 | `trophy-gold` | A modern motorsport trophy cup, polished gold, faceted angular design, on a black base |
| E15 | `trophy-silver` | Same trophy, polished silver |
| E16 | `trophy-bronze` | Same trophy, polished bronze |
| E17 | `coin` | A single thick game coin, black enamel face with an embossed abstract pulse-line emblem, lime glowing edge, slight tilt |
| E18 | `coin-stack` | A small leaning stack of five such coins with one coin standing on its edge in front |
| E19 | `gift` | A matte black gift box with a lime ribbon and bow, lid slightly lifted, light rays inside |
| E20 | `flame` | A stylized flame shaped like a speed streak, orange-to-amber gradient, glowing core (for daily streak) |
| E21 | `steering-wheel` | A modern single-seater steering wheel, carbon fibre, buttons and paddles, blank dark display |
| E22 | `pit-gun` | A pneumatic wheel gun used in pit stops, black with lime hose connector |

### F. Hero механик пулов — 9 шт.

**Где:** hero экрана пула (02, §9.3), полоса «Следующий прогноз» на главной, featured в эфире. **Ген.:** 1536×1024. **Композиция:** главный объект в правой половине, **левые 45 % тёмные** под текст. **Файл:** `plates/pool-<layout>.png`.

| ID | Файл | Промпт (+ house style) |
|---|---|---|
| F1 | `pool-zone` | Low-angle night view down a floodlit circuit straight, three translucent light curtains in lime, cyan and violet hanging over three sections of track like sector gates, car light streaks passing through, empty dark left side |
| F2 | `pool-position` | A starting grid at night seen from above and behind, rows of grid-slot markings on wet asphalt glowing faintly, one slot lit in lime, long shadows, empty dark left side |
| F3 | `pool-duel` | Two open-wheel race cars nose to tail at speed through a night corner, one in orange tones and one in red tones, generic liveries, motion blur on the background, sparks under the floor, empty dark left side |
| F4 | `pool-pit` | A pit lane at night, a race car stopped in its box, a crew in dark fire suits (faces hidden by helmets, backs to camera) changing wheels, overhead gantry lights, tyre smoke wisps, empty dark left side |
| F5 | `pool-tyre` | A neat stack wall of racing tyres in a garage at night, coloured sidewall bands in red, yellow and white, tyre blankets, cool rim light, shallow depth of field, empty dark left side |
| F6 | `pool-pace` | A close-up of a race car's front wing and wheel at extreme speed, horizontal light streaks, a faint stopwatch-dial shaped light reflection on the asphalt, empty dark left side |
| F7 | `pool-incident` | A rainy night circuit, a marshal post waving a large yellow flag in the foreground right, a safety car with an amber light bar approaching in the background, spray and reflections, empty dark left side |
| F8 | `pool-quali` | A race car leaving a brightly lit garage into the dark pit lane, light spilling across wet floor, mechanics' silhouettes from behind, empty dark left side |
| F9 | `pool-combo` | An abstract composition: four glowing ticket-shaped light panels floating in a dark space above a circuit, connected by a single lime light line like a race track, depth of field, empty dark left side |

### G. Плиты экранов — 3 шт.

| ID | Файл | Ген. | Где | Промпт (+ house style) |
|---|---|---|---|---|
| G1 | `plates/home-fallback` | 1536×1024 | Hero главной, пока нет данных канала | A wide night aerial of an anonymous floodlit circuit complex in a city, glowing grandstands, light trails, dark calm centre-left |
| G2 | `plates/live-loading` | 1024×1536 | Загрузка эфира | A vertical shot of five race start lights on a gantry glowing red in fog, wet grid below, everything else dark |
| G3 | `plates/offline` | 1536×1024 | Офлайн или данные на паузе | A dark empty pit wall at night, monitors turned off, single work lamp, rain on the glass, calm and quiet |

### H. Значки достижений и уровня — 13 шт. (прозрачный фон, «свой стиль»)

**Где:** профиль (лента и «ближайшее достижение»), награды, празднование. Закрытое состояние делается в CSS (`grayscale(1) brightness(.6)`), отдельные картинки не нужны. **Ген.:** 1024². **Файл:** `badges/<id>.png`.

**Шаблон (свой стиль, без house style):**
```
A collectible enamel pin badge, hexagonal shield shape with a polished metal rim, glossy
coloured enamel fill in {TONE}, a raised metal emblem of {EMBLEM} in the centre, subtle
lime glint on the rim, isolated, studio product render, no text, no numbers.
```

| ID | Файл (= id в `src/demo/progress.ts`) | {TONE} | {EMBLEM} |
|---|---|---|---|
| H01 | `rookie` | lime green | a small waving chequered flag |
| H02 | `firstWin` | warm gold | a trophy cup |
| H03 | `hatTrick` | orange | three flames side by side |
| H04 | `duelist` | cyan | two crossed arrows overtaking each other |
| H05 | `pitWall` | violet | a pit-stop wheel gun |
| H06 | `strategist` | red | a racing tyre |
| H07 | `sectorAce` | lime green | a target reticle over a track curve |
| H08 | `safetyFirst` | yellow | a warning triangle with a safety-car roof light |
| H09 | `globetrotter` | cyan | a globe with a circuit outline orbiting it |
| H10 | `highRoller` | orange | a lightning bolt over a coin stack |
| H11 | `jackpot` | violet | a five-point star bursting with light |
| H12 | `veteran` | lime green | a racing helmet in side view |
| H13 | `level` | graphite with lime rim | an empty laurel-free circular plate (the level number is drawn by the UI) |

### I. Текстуры — 3 шт.

| ID | Файл | Ген. | Где | Промпт |
|---|---|---|---|---|
| I1 | `textures/carbon` | 512² бесшовная | Фон тикета и hero-панелей, `opacity .06` | *свой стиль:* `Seamless tileable carbon fibre twill weave texture, very dark charcoal, subtle sheen, flat lighting, no vignette` |
| I2 | `textures/asphalt` | 512² бесшовная | Фон S0, `opacity .05` | *свой стиль:* `Seamless tileable dark asphalt macro texture, fine aggregate, very low contrast, flat lighting` |
| I3 | `textures/grain` | 256² бесшовная | Плёночное зерно поверх плит, `opacity .04`, `mix-blend: overlay` | *свой стиль:* `Seamless monochrome film grain noise, mid-grey, uniform` |

### J. Онбординг и пустые состояния — 7 шт.

| ID | Файл | Ген. | Где | Промпт (+ house style) |
|---|---|---|---|---|
| J1 | `art/onb-1-lights` | 1024×1536 | Онбординг 1 «Гонка идёт — вы в игре» | A low view of a starting grid at night, five red start lights on the gantry above, a single car's rear wing and lime rear rain-light in the foreground, tension, empty dark lower third |
| J2 | `art/onb-2-zones` | 1024×1536 | Онбординг 2 «Выберите момент» | High aerial of a night circuit section with three translucent coloured light zones (lime, cyan, violet) over the track, one car crossing into the lime zone, empty dark lower third |
| J3 | `art/onb-3-swipe` | 1024×1536 | Онбординг 3 «Подтвердите прогноз» | A gloved hand in a racing glove pressing a glowing lime button on a carbon steering wheel, dark cockpit, shallow depth of field, empty dark lower third |
| J4 | `art/empty-picks` | 1024² прозр. | «Мои пулы», пусто | *свой стиль:* A floating stylized race ticket made of dark glass with a lime glowing edge and a perforated stub, small chequered pattern corner, isolated |
| J5 | `art/empty-results` | 1024² прозр. | «Итоги», пусто | *свой стиль:* A chequered flag folded neatly on a dark podium step, soft top light, isolated |
| J6 | `art/empty-history` | 1024² прозр. | История, пусто | *свой стиль:* An empty open notebook with a carbon cover and a lime bookmark ribbon, isolated |
| J7 | `art/empty-feed` | 1024² прозр. | Эфир, вкладка «События», пусто | *свой стиль:* A trackside radio headset hanging on a hook, a small lime status LED, isolated |

### K. Празднования — 3 шт.

| ID | Файл | Ген. | Где | Промпт (+ house style) |
|---|---|---|---|---|
| K1 | `art/cel-win` | 1024×1536 | Выигрыш | A triumphant night celebration: lime and gold light streaks bursting upward from a podium silhouette, floating game coins with glowing edges, confetti made of light, energetic but dark centre for text |
| K2 | `art/cel-loss` | 1024×1536 | Проигрыш | A quiet rainy night pit lane after the race, single lamp, puddles reflecting distant lights, calm, contemplative, dark centre for text |
| K3 | `art/cel-levelup` | 1024×1536 | Новый уровень | A hexagonal metal badge rising out of a ring of lime light, sparks, dark surroundings, dark centre for text |

---

## 4. Порядок генерации (приоритет)

1. **E01–E22, D01–D12** — объекты и шлемы. Нужны почти на каждом экране и дают максимум эффекта за минимум работы.
2. **F1–F9** — hero механик: закрывают главный пробел в пулах (01, P1-1).
3. **B: сначала 8 трасс демо-каналов** (`src/demo/channels.ts`): `mx-1962`, `ae-2009`, `cn-2004`, `gb-1948`, `it-1922`, `jp-1962`, `mc-1929`, `us-2023`. Потом остальные 16.
4. **C01–C11** — болиды для дуэли и пилота.
5. **H, J, K, G, I, A2**.

После каждой пачки — чек-лист §2.4, запуск `scripts/build-assets.mjs`, проверка в `dev/ui.html` и на целевом экране.
