"use strict";

const fs = require("fs");
const path = require("path");
const {
  BUNDLES,
  REQUIRED_SOURCE_ASSETS
} = require("./frontend-assets.cjs");

const root = __dirname;
const indexPath = path.join(root, "index.html");
const publicFilesPath = path.join(root, "public-files.json");
const CHECK_ONLY = process.argv.includes("--check");

// Gardés ici aussi car ci-check.cjs vérifie explicitement ces sorties.
const GENERATED_OUTPUT_MARKERS = Object.freeze([
  "ptb-category-avatar-patches.css",
  "ptb-ui-wheel-patches.css",
  "ptb-late-patches.css",
  "ptb-core-client.js",
  "ptb-ui-patches.js",
  "ptb-late-client.js"
]);

function log(message) {
  console.log(`[Frontend build] ${message}`);
}

function buildVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(root, "package.json"),
        "utf8"
      )
    );
    return String(pkg?.version || "1.46.1");
  } catch {
    return "1.46.1";
  }
}

function htmlAssetPath(tag, type) {
  const attribute =
    type === "css"
      ? "href"
      : "src";

  const match = tag.match(
    new RegExp(
      `${attribute}=["']([^"']+)["']`,
      "i"
    )
  );

  if (!match) return "";

  return String(match[1])
    .split("?")[0]
    .replace(/^\/+/, "");
}

function findAssetTags(html, type) {
  const pattern =
    type === "css"
      ? /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi
      : /<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi;

  const tags = [];
  let match;

  while ((match = pattern.exec(html))) {
    const assetPath =
      htmlAssetPath(
        match[0],
        type
      );

    if (!assetPath) continue;

    tags.push({
      start: match.index,
      end: match.index + match[0].length,
      tag: match[0],
      path: assetPath
    });
  }

  return tags;
}

function validateManifest() {
  const outputs =
    BUNDLES.map(bundle => bundle.output);

  const expected =
    [...GENERATED_OUTPUT_MARKERS].sort();

  const actual =
    [...outputs].sort();

  if (
    JSON.stringify(actual) !==
    JSON.stringify(expected)
  ) {
    throw new Error(
      "frontend-assets.cjs ne déclare pas les six bundles de production attendus."
    );
  }

  const seenSources = new Set();

  for (const bundle of BUNDLES) {
    if (
      !bundle ||
      !["css", "js"].includes(bundle.type)
    ) {
      throw new Error(
        "Bundle frontend invalide."
      );
    }

    if (
      !bundle.output ||
      !Array.isArray(bundle.files) ||
      !bundle.files.length
    ) {
      throw new Error(
        `Bundle incomplet: ${bundle?.output || "sans nom"}.`
      );
    }

    for (const file of bundle.files) {
      if (seenSources.has(file)) {
        throw new Error(
          `Asset présent dans plusieurs bundles: ${file}.`
        );
      }

      seenSources.add(file);
    }
  }

  for (const file of REQUIRED_SOURCE_ASSETS) {
    if (
      !fs.existsSync(
        path.join(root, file)
      )
    ) {
      throw new Error(
        `Asset frontend absent: ${file}.`
      );
    }
  }
}

function concatenate(config) {
  const chunks = [];

  for (const file of config.files) {
    const filePath =
      path.join(root, file);

    const content =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    chunks.push(
      config.type === "css"
        ? `/* ===== ${file} ===== */\n${content.trim()}\n`
        : `/* ===== ${file} ===== */\n${content.trim()}\n;\n`
    );
  }

  const content =
    chunks.join("\n");

  if (config.type === "js") {
    new Function(content);
  }

  return content;
}

function bundleTag(
  config,
  version
) {
  const url =
    `/${config.output}?v=${encodeURIComponent(version)}`;

  if (config.type === "css") {
    const id =
      config.id
        ? ` id="${config.id}"`
        : "";

    return (
      `<link${id} rel="stylesheet" href="${url}" />`
    );
  }

  return (
    `<script defer src="${url}"></script>`
  );
}

function replaceGroup(
  html,
  config,
  version
) {
  const tags =
    findAssetTags(
      html,
      config.type
    );

  const selected = [];

  for (const file of config.files) {
    const matches =
      tags.filter(
        entry =>
          entry.path === file
      );

    if (matches.length !== 1) {
      throw new Error(
        `${config.output}: ${file} doit apparaître exactement une fois dans index.html.`
      );
    }

    selected.push(
      matches[0]
    );
  }

  for (
    let index = 1;
    index < selected.length;
    index += 1
  ) {
    if (
      selected[index].start <=
      selected[index - 1].start
    ) {
      throw new Error(
        `${config.output}: ordre inattendu dans index.html.`
      );
    }
  }

  const selectedPaths =
    new Set(
      selected.map(
        entry => entry.path
      )
    );

  const interleaved =
    tags.filter(entry =>
      entry.start >= selected[0].start &&
      entry.end <=
        selected[selected.length - 1].end &&
      !selectedPaths.has(entry.path)
    );

  if (interleaved.length) {
    throw new Error(
      `${config.output}: fichiers intercalés: ` +
      interleaved
        .map(entry => entry.path)
        .join(", ")
    );
  }

  const replacement =
    bundleTag(
      config,
      version
    );

  let next = html;

  for (
    let index =
      selected.length - 1;
    index >= 0;
    index -= 1
  ) {
    const item =
      selected[index];

    next =
      next.slice(0, item.start) +
      (
        index === 0
          ? replacement
          : ""
      ) +
      next.slice(item.end);
  }

  return next;
}

function loadPublicFiles() {
  if (
    !fs.existsSync(
      publicFilesPath
    )
  ) {
    throw new Error(
      "public-files.json absent."
    );
  }

  const list =
    JSON.parse(
      fs.readFileSync(
        publicFilesPath,
        "utf8"
      )
    );

  if (!Array.isArray(list)) {
    throw new Error(
      "public-files.json doit contenir un tableau."
    );
  }

  return list;
}

function validateMobileRuntimeOrder(
  html
) {
  const scripts =
    findAssetTags(
      html,
      "js"
    ).map(
      entry => entry.path
    );

  const runtimeIndex =
    scripts.indexOf(
      "mobile-runtime.js"
    );

  const appIndex =
    scripts.indexOf(
      "app.js"
    );

  if (runtimeIndex < 0) {
    throw new Error(
      "mobile-runtime.js doit être chargé dans index.html."
    );
  }

  if (
    appIndex < 0 ||
    runtimeIndex > appIndex
  ) {
    throw new Error(
      "mobile-runtime.js doit être chargé avant app.js."
    );
  }
}

function buildFrontend() {
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      "index.html absent."
    );
  }

  validateManifest();

  const originalHtml =
    fs.readFileSync(
      indexPath,
      "utf8"
    );

  validateMobileRuntimeOrder(
    originalHtml
  );

  const originalPublicFiles =
    loadPublicFiles();

  const version =
    buildVersion();

  let html =
    originalHtml;

  const publicFiles =
    [...originalPublicFiles];

  const generated = [];

  for (const config of BUNDLES) {
    const content =
      concatenate(config);

    html =
      replaceGroup(
        html,
        config,
        version
      );

    const route =
      `/${config.output}`;

    if (
      !publicFiles.includes(route)
    ) {
      publicFiles.push(route);
    }

    generated.push({
      name: config.output,
      content,
      sourceCount:
        config.files.length
    });
  }

  const beforeRequests =
    findAssetTags(
      originalHtml,
      "css"
    ).length +
    findAssetTags(
      originalHtml,
      "js"
    ).length;

  const afterRequests =
    findAssetTags(
      html,
      "css"
    ).length +
    findAssetTags(
      html,
      "js"
    ).length;

  if (CHECK_ONLY) {
    log(
      `validation OK : ${generated.length} bundles, ` +
      `${beforeRequests} -> ${afterRequests} requêtes CSS/JS.`
    );
    return;
  }

  for (const file of generated) {
    fs.writeFileSync(
      path.join(
        root,
        file.name
      ),
      file.content,
      "utf8"
    );
  }

  fs.writeFileSync(
    indexPath,
    html,
    "utf8"
  );

  fs.writeFileSync(
    publicFilesPath,
    JSON.stringify(
      publicFiles,
      null,
      2
    ) + "\n",
    "utf8"
  );

  log(
    `${generated.length} bundles générés : ` +
    `${beforeRequests} -> ${afterRequests} requêtes CSS/JS.`
  );

  for (const file of generated) {
    log(
      `${file.name}: ` +
      `${file.sourceCount} -> 1`
    );
  }
}

try {
  buildFrontend();
} catch (error) {
  console.error(
    "[Frontend build] ERREUR:",
    error?.stack ||
    error?.message ||
    error
  );

  process.exitCode = 1;
}
