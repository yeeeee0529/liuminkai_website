#!/usr/bin/env node

// Scans photo/ and generates photo/manifest.js consumed by photo.html.
// Work convention: photo/<work-name>/ contains image files and .txt notes.
// Run manually: node scripts/build-photo-manifest.js
//
// Images larger than MAX_IMAGE_BYTES are compressed in place before the
// manifest is written, so Cloudflare Pages' 25 MiB per-file limit never
// blocks a deploy. Recompress with sharp; the original is preserved in Git
// history.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const photoDir = path.join(root, "photo");
const manifestPath = path.join(photoDir, "manifest.js");

// Cloudflare Pages rejects files over 25 MiB; leave headroom for metadata.
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const COMPRESS_MAX_EDGE = 4096;
const COMPRESS_QUALITY = 80;

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const NOTE_EXTENSION = ".txt";

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }
    return `${Math.round(bytes / 1024)} KiB`;
}

async function compressIfNeeded(workName, image) {
    const filePath = path.join(photoDir, workName, image);
    const before = fs.statSync(filePath).size;
    if (before <= MAX_IMAGE_BYTES) {
        return;
    }

    const sharp = require("sharp");
    const buffer = await sharp(filePath, { failOn: "none" })
        .rotate()
        .resize({
            width: COMPRESS_MAX_EDGE,
            height: COMPRESS_MAX_EDGE,
            fit: "inside",
            withoutEnlargement: true
        })
        .jpeg({ quality: COMPRESS_QUALITY, mozjpeg: true })
        .toBuffer();

    if (buffer.length >= before) {
        console.log(`  - ${workName}/${image}: ${formatBytes(before)} unchanged (recompression not smaller)`);
        return;
    }

    fs.writeFileSync(filePath, buffer);
    console.log(`  - ${workName}/${image}: ${formatBytes(before)} -> ${formatBytes(buffer.length)}`);
}

function byName(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function listWorks() {
    if (!fs.existsSync(photoDir)) {
        return [];
    }

    const works = [];
    for (const entry of fs
        .readdirSync(photoDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."))
        .sort((a, b) => byName(a.name, b.name))) {
        const name = entry.name;
        const dir = path.join(photoDir, name);
        const files = fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((dirent) => dirent.isFile())
            .map((dirent) => dirent.name)
            .sort(byName);

        const images = files.filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
        for (const image of images) {
            await compressIfNeeded(name, image);
        }

        const caption = files
            .filter((file) => path.extname(file).toLowerCase() === NOTE_EXTENSION)
            .map((file) => fs.readFileSync(path.join(dir, file), "utf8").replaceAll("\r\n", "\n").trimEnd())
            .join("\n\n");

        works.push({
            slug: name,
            title: name,
            images: images.map((file) => `photo/${name}/${file}`),
            caption
        });
    }
    return works;
}

async function main() {
    const works = await listWorks();
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
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
