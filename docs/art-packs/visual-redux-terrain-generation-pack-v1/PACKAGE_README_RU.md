# Что находится в terrain generation pack

Пакет рассчитан на одну генерацию полного terrain atlas.

- `PROMPT_RU.md` — готовое подробное ТЗ для GPT Image.
- `NEGATIVE_PROMPT_RU.txt` — добавляется к запросу целиком.
- `manifest.json` — размеры, сетка `3×2`, порядок материалов и QA-контракт.
- `references/01_current_terrain_authoritative.png` — главный layout/palette reference.
- `references/02_current_ores_contrast_only.png` — проверка контраста; руду не перерисовывать.
- `references/03_current_veins_contrast_only.png` — проверка контраста; жилы не перерисовывать.
- `references/04_field_master_style_only.png` — необязательный style-only reference.

В GPT Image передавать один запрос на весь atlas `1536×1024`. Выход должен быть одним opaque PNG без мокапа, подписей и дополнительных изображений. Runtime-файл заменяется только после seam, 28 px и ore-composite QA из основного ТЗ.
