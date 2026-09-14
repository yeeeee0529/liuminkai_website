#!/usr/bin/env node

// Scans photo/ and generates photo/manifest.js consumed by photo.html.
// Work convention: photo/<work-name>/ contains image files and .txt notes.
// Run manually: node scripts/build-photo-manifest.js

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const photoDir = path.join(root, "photo");
const manifestPath = path.join(photoDir, "manifest.js");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const NOTE_EXTENSION = ".txt";

function byName(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function listWorks() {
    if (!fs.existsSync(photoDir)) {
        return [];
    }

    return fs
        .readdirSync(photoDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort(byName)
        .map((name) => {
            const dir = path.join(photoDir, name);
            const files = fs
                .readdirSync(dir, { withFileTypes: true })
                .filter((entry) => entry.isFile())
                .map((entry) => entry.name)
                .sort(byName);

            const images = files.filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
            const caption = files
                .filter((file) => path.extname(file).toLowerCase() === NOTE_EXTENSION)
                .map((file) => fs.readFileSync(path.join(dir, file), "utf8").replaceAll("\r\n", "\n").trimEnd())
                .join("\n\n");

            return {
                slug: name,
                title: name,
                images: images.map((file) => `photo/${name}/${file}`),
                caption
            };
        });
}

const works = listWorks();
const payload = `window.PHOTO_WORKS = ${JSON.stringify(works, null, 4)};\n`;

fs.writeFileSync(manifestPath, payload, "utf8");

if (works.length === 0) {
    console.log("photo manifest: no works found (photo/ is empty or missing)");
} else {
    console.log(`photo manifest: ${works.length} work(s) written to photo/manifest.js`);
    works.forEach((work) => {
        const note = work.caption ? "caption" : "no caption";
        console.log(`  - ${work.slug} (${work.images.length} image(s), ${note})`);
    });
}
