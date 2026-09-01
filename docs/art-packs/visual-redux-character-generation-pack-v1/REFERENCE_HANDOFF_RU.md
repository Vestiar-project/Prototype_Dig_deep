# Передача current references в GPT Image

Версия: 1.0, 2026-08-31.

Цель передачи референсов — сохранить конкретного шахтёра и семь уже придуманных инструментов, но не перенести в redux-набор старую микродетализацию, случайный дрейф тела и различия масштаба.

Основной режим этого пакета — one-shot contact sheet `5×7` из `FULL_PACK_PROMPT_RU.md`. Описанные ниже tier-batches используются только если полный лист не прошёл QA. Это не рекомендация начинать с цепочки мелких edit-запросов.

## 1. Приоритет источников

При любом конфликте действует следующий порядок:

1. Числовой контракт из `MASTER_BODY_AND_ANIMATION_SPEC_RU.md` и `manifest.json`.
2. Для первой full-pack генерации: current `v01_worn_pick_idle` плюс главное меню — identity и общий художественный язык.
3. Для fallback после первого принятого результата: утверждённый redux `v01_worn_pick_idle` — новый master body.
4. Current frames — только форма оборудования и смысл поз; не источник масштаба и микродетализации.
5. Последний утверждённый redux-strip того же tier — согласованность соседних поз в fallback.
6. Референс породы — только проверка контраста в игровом окружении.

Старый кадр никогда не имеет права отменить новый pivot, baseline, одинаковый рост и detail budget.

## 2. Авторитетные current references

Все пути указаны от корня репозитория.

### Идентичность и общий художественный язык

- `assets/characters/miner/miner_v01_worn_pick_idle.png` — основной current reference профиля, бороды, каски, палитры и пропорций.
- `assets/main-menu/main-menu-hero-desktop.png` — только крупный ключевой образ мира: rust-comic, индустриальные материалы, оранжевый и teal. Не копировать его ракурс со спины, фон и степень микродетализации.
- `docs/art-references/depth-zero-current-terrain-reference.png` — только проверка читаемости рядом с породой. Порода не должна появиться в character PNG.
- `assets/characters/miner/animation_manifest.json` — current filenames, canvas, baseline и pivot.

`docs/art-references/miner_v01_worn_pick_idle.png` идентичен runtime-файлу v01 idle. Прикладывать оба дубля одновременно не нужно.

### Current pose set v01

- `assets/characters/miner/miner_v01_worn_pick_idle.png`
- `assets/characters/miner/miner_v01_worn_pick_step.png`
- `assets/characters/miner/miner_v01_worn_pick_prepare.png`
- `assets/characters/miner/miner_v01_worn_pick_contact.png`
- `assets/characters/miner/miner_v01_worn_pick_recoil.png`

Эти пять файлов задают смысл действия, но не точную траекторию. Особенно не повторять большой сдвиг массы между `prepare`, `contact` и `recoil`, мелкие искры внутри contact и статичную широко расставленную step-позу.

### Current equipment references по tier

Для выбранного `{TIER_ID}` прикладываются ровно пять файлов с тем же префиксом из `assets/characters/miner/`:

- melee v01–v05: `_idle`, `_step`, `_prepare`, `_contact`, `_recoil`;
- ranged v06–v07: `_idle`, `_step`, `_aim`, `_fire`, `_recoil`.

Префиксы:

1. `miner_v01_worn_pick`
2. `miner_v02_iron_pick`
3. `miner_v03_steel_pick`
4. `miner_v04_pneumatic_pick`
5. `miner_v05_super_pick`
6. `miner_v06_mining_laser`
7. `miner_v07_solar_drill`

Для основного one-shot запроса допустимо приложить все 35 current PNG, если интерфейс поддерживает столько references: `FULL_PACK_PROMPT_RU.md` жёстко разделяет их по рядам. При ограничении слотов использовать пять v01 frames и семь idle-кадров tiers; остальные current frames опускать. В fallback-запросе одного ряда прикладывать только пять PNG этого tier, чтобы не смешивать инструменты.

## 3. Рекомендуемый порядок генерации

### Основной проход — весь пакет

1. Приложить `style-main-menu-hero.png`.
2. Приложить пять current v01 frames.
3. Приложить семь current idle-кадров v01…v07.
4. При доступных слотах добавить остальные current frames.
5. Terrain context добавлять последним и только с пометкой `contrast-only`.
6. Передать `FULL_PACK_PROMPT_RU.md` и negative prompt целиком.

Получить один лист `5×7`, проверить все строки по `QA_CHECKLIST_RU.md` и разрезать только после общей приёмки. Если один ряд непригоден, повторить целиком этот ряд по fallback ниже.

### Fallback: Batch 0 — калибровка master body

Приложить:

1. пять current PNG v01;
2. `main-menu-hero-desktop.png` как style-only reference;
3. при наличии отдельного reference-слота — `depth-zero-current-terrain-reference.png` как contrast-only reference.

Передать master-body prompt из `PROMPT_RU.md` и negative prompt целиком. Получить один v01 strip из пяти поз. Не переходить к другим tiers, пока v01 idle, baseline и возврат recoil → idle не утверждены.

После утверждения вырезанный redux `miner_v01_worn_pick_idle.png` становится главным master-body reference. Не использовать старый v01 idle вместо него в следующих batch.

### Batch 1–4 — v02…v05

На каждый tier делать отдельный запрос. Приложить:

1. утверждённый redux v01 idle — identity/master reference;
2. утверждённый redux v01 strip или компактный pose reference — pose/anchor reference;
3. пять current PNG только нужного tier — equipment-only reference;
4. для v05 дополнительно можно приложить current v04 idle, чтобы технологический переход оставался промышленным.

В тексте запроса явно написать: «Тело и его пиксельные anchors бери из redux master; current tier PNG используй только для конструкции инструмента, рюкзака и смысла действий».

### Batch 5–6 — v06 и v07

Приложить:

1. утверждённый redux v01 idle;
2. утверждённый redux ranged pose template, если он уже существует; для первого ranged tier — утверждённый redux v05 idle как масштабный ориентир;
3. пять current PNG выбранного ranged tier;
4. для v07 — также утверждённый redux v06 idle, чтобы drill выглядел следующим промышленным уровнем, а не новым магическим персонажем.

Aim и fire должны рассматриваться парой. Если один из них исправляется, второй передавать в reference той же edit-сессии, чтобы muzzle не изменил координату.

## 4. Если интерфейс ограничивает количество references

Минимальный набор в порядке важности:

1. утверждённый redux v01 idle;
2. current idle выбранного tier;
3. current contact/fire выбранного tier;
4. current recoil выбранного tier;
5. current prepare/aim или step — в зависимости от генерируемого кадра.

Главное меню и terrain reference в этом случае опускаются первыми. Их отсутствие менее опасно, чем отсутствие master body.

Если широкая полоса из пяти поз не поддерживается, использовать последовательный режим:

1. генерировать `idle`;
2. прикладывать утверждённый `idle` к `step`;
3. прикладывать `idle + step` к `prepare/aim`;
4. прикладывать `idle + prepare/aim` к `contact/fire`;
5. прикладывать `idle + contact/fire` к `recoil`.

Каждый одиночный кадр всё равно создаётся на полном `512×512` canvas с pivot `(193,450)`. Нельзя автоматически центрировать crop вокруг нового силуэта.

## 5. Как описывать назначение каждого изображения модели

В запросе перед списком вложений добавить короткую легенду:

```text
REFERENCE A — утверждённый redux master body; обязателен для идентичности, пропорций и anchors.
REFERENCE B — current equipment; брать только крупную конструкцию инструмента и рюкзака, не брать детализацию и масштаб тела.
REFERENCE C — current pose; брать смысл действия, но исправить траекторию по технической схеме.
REFERENCE D — key art; брать только палитру и индустриальный rust-comic mood, не брать фон и крупноплановую детализацию.
REFERENCE E — terrain context; использовать только как мысленную проверку контраста, ничего из него не рисовать.
```

## 6. Что нельзя делать с references

- Не просить «точно скопировать каждый current frame»: это закрепит старое морфирование.
- Не разрешать модели самостоятельно выбирать главный reference.
- Не смешивать current v05 с v06/v07 в одном листе: cyan-модули легко мигрируют между tiers.
- Не использовать чёрный preview-фон как часть изображения. Исходники имеют настоящий alpha, даже если просмотрщик показывает прозрачность чёрным.
- Не передавать terrain reference без явной пометки `context only`: иначе в alpha попадут камни и земля.
- Не использовать сгенерированный, но не прошедший QA кадр как следующий master reference.

## 7. Повторная правка

При неудаче не перегенерировать весь набор с новым свободным prompt. Зафиксировать принятые кадры как references и запросить одну конкретную правку:

- «совместить boot contact с y=450»;
- «вернуть master helmet без изменения инструмента»;
- «сохранить aim целиком и изменить только внутреннюю яркость core для fire»;
- «убрать внешнюю искру, не менять руки и muzzle»;
- «вернуть тело к pivot x=193, не центрировать по длинному инструменту».

После каждой правки заново выполнять alpha, overlay и thumbnail QA.
