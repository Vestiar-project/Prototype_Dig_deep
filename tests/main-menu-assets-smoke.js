"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function count(source, fragment) {
  return source.split(fragment).length - 1;
}

function pngMetadata(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.strictEqual(bytes.subarray(1, 4).toString("ascii"), "PNG", `${filePath} is not a PNG`);
  assert.strictEqual(bytes.subarray(12, 16).toString("ascii"), "IHDR", `${filePath} has no IHDR`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

const assets = [
  ["main-menu-hero-desktop.png", 1600, 1200, true],
  ["main-menu-hero-mobile.png", 1080, 1440, true],
  ["main-menu-rocket-schematic.png", 1200, 720, false],
];

for (const [name, width, height, isUsed] of assets) {
  const filePath = path.join(root, "assets", "main-menu", name);
  assert.ok(fs.existsSync(filePath), `missing ${name}`);
  assert.deepStrictEqual(
    pngMetadata(filePath),
    { width, height, bitDepth: 8, colorType: 2 },
    `${name} must remain an opaque 8-bit RGB PNG at the authored size`,
  );
  assert.strictEqual(
    html.includes(`assets/main-menu/${name}`),
    isUsed,
    `${name} reference state does not match the current menu composition`,
  );
}

for (const id of [
  "startScreen",
  "gameTitle",
  "gameIntro",
  "startRun",
  "replayTutorial",
  "startUpgrades",
  "campaignStatus",
]) {
  assert.strictEqual(count(html, `id="${id}"`), 1, `${id} must remain unique`);
}

assert.ok(html.includes('class="overlay start-screen has-menu-art"'), "menu-art scope is missing");
assert.ok(html.includes('class="menu-hero-art"'), "responsive hero picture is missing");
assert.ok(html.includes('media="(max-width: 1199px)"'), "mobile hero source is missing");
assert.ok(html.includes('class="brand-command"'), "mobile command block is missing");
assert.ok(!html.includes('class="briefing-art"'), "separate rocket panel must stay removed");
assert.ok(html.includes("visual-redux-2"), "visual-redux cache version was not updated");
assert.ok(html.includes("СПРАВКА"), "the tertiary help action is missing");
const startRunMarkup = html.match(/<button id="startRun"[\s\S]*?<\/button>/u)?.[0] || "";
assert.match(startRunMarkup, /class="btn-icon btn-icon--play"[^>]*><\/span>/u, "Dig must use the font-independent play icon");
assert.doesNotMatch(startRunMarkup, /\u25b6/u, "Dig must not fall back to an emoji-capable play glyph");
assert.match(
  css,
  /\.btn-icon--play::before\s*\{[\s\S]*?border-left:\s*11px solid currentColor/u,
  "the play icon must be drawn as CSS geometry rather than a platform font glyph",
);
assert.ok(
  html.indexOf('id="startRun"') < html.indexOf('id="startUpgrades"')
    && html.indexOf('id="startUpgrades"') < html.indexOf('id="replayTutorial"'),
  "main-menu actions must follow Dig → Upgrades → Help",
);

assert.ok(css.includes("Production main-menu art pack"), "menu art CSS contract is missing");
assert.ok(css.includes("grid-template-columns: minmax(0, 1fr)"), "desktop hero must span the whole menu");
assert.ok(css.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"), "desktop briefing must be a horizontal three-card row");
assert.ok(css.includes("left: clamp(500px, 35%, 570px)"), "desktop briefing overlay anchor is missing");
assert.ok(css.includes("width: min(470px, calc(50% - 90px))"), "desktop action cluster must stay centered in the left half");
assert.ok(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "secondary actions must share the row below Dig");
assert.ok(css.includes("@media (max-width: 1199px)"), "mobile menu breakpoint is missing");
assert.ok(!css.includes("max-aspect-ratio"), "desktop layout must not switch to mobile because of window shape");
assert.ok(css.includes("aspect-ratio: 3 / 4"), "mobile hero ratio is missing");
assert.ok(css.includes("object-position: 50% 50%"), "desktop focal point is missing");
assert.ok(css.includes("object-position: 50% 52%"), "mobile focal point is missing");

console.log("main-menu-assets-smoke: ok");
