# Что находится в character generation pack

Пакет готов к пересылке в GPT Image целиком.

- `FULL_PACK_PROMPT_RU.md` — основной запрос на один лист `5×7`, все 35 кадров сразу.
- `PROMPT_RU.md` — полный art direction и fallback-запросы на целый tier `5×1`.
- `MASTER_BODY_AND_ANIMATION_SPEC_RU.md` — master body, anchors, pivot, baseline и допустимые движения.
- `REFERENCE_HANDOFF_RU.md` — приоритет и роли референсов.
- `NEGATIVE_PROMPT_RU.txt` — добавляется к запросу целиком.
- `QA_CHECKLIST_RU.md` — проверка листа до разрезания и интеграции.
- `manifest.json` — machine-readable контракт 35 будущих runtime PNG.
- `references/current-runtime-miner/` — все текущие 35 кадров плюс действующие manifests.
- `references/style-main-menu-hero.png` — style/identity reference.
- `references/contrast-current-terrain.png` — только проверка читаемости при уменьшении.

Основной сценарий: загрузить reference-приоритет из `FULL_PACK_PROMPT_RU.md`, вставить его текст и negative prompt, получить единый лист. Если модель не удержала только один ряд, перегенерировать этот ряд целиком по `PROMPT_RU.md`; не начинать с точечных дорисовок отдельных кадров.
