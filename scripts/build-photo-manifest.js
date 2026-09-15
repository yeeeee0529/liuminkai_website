#!/usr/bin/env node

// 掃描 photo/、將照片轉成 WebP，並建立可直接部署的 dist/ 目錄。
// 作品目錄格式：photo/<work-name>/ 內放圖片及 .txt 說明文字。

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DEFAULT_ROOT = path.join(__dirname, "..");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const NOTE_EXTENSION = ".txt";
const STATIC_FILES = ["contact.html", "icon.jpeg", "liuminkai.html"];
const WEBP_MAX_EDGE = 4096;
const WEBP_QUALITY = 80;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

function byName(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }
    return `${Math.round(bytes / 1024)} KiB`;
}

function getWebpName(fileName) {
    return `${path.parse(fileName).name}.webp`;
}

async function convertToWebp(sourcePath, outputPath) {
    const before = fs.statSync(sourcePath).size;

    await sharp(sourcePath, { animated: true, failOn: "none" })
        .rotate()
        .resize({
            width: WEBP_MAX_EDGE,
            height: WEBP_MAX_EDGE,
            fit: "inside",
            withoutEnlargement: true
        })
        .webp({ effort: 4, quality: WEBP_QUALITY })
        .toFile(outputPath);

    const after = fs.statSync(outputPath).size;
    if (after > MAX_IMAGE_BYTES) {
        throw new Error(
            `Generated image exceeds the 24 MiB deployment limit: ${outputPath} (${formatBytes(after)})`
        );
    }

    return { before, after };
}

function copyStaticFiles(root, distDir) {
    for (const fileName of STATIC_FILES) {
        const sourcePath = path.join(root, fileName);
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Required static file not found: ${sourcePath}`);
        }
        fs.copyFileSync(sourcePath, path.join(distDir, fileName));
    }
}

async function buildWorks(photoDir, outputPhotoDir) {
    if (!fs.existsSync(photoDir)) {
        return [];
    }

    const works = [];
    const workEntries = fs
        .readdirSync(photoDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .sort((a, b) => byName(a.name, b.name));

    for (const entry of workEntries) {
        const workName = entry.name;
        const sourceWorkDir = path.join(photoDir, workName);
        const outputWorkDir = path.join(outputPhotoDir, workName);
        const files = fs
            .readdirSync(sourceWorkDir, { withFileTypes: true })
            .filter((dirent) => dirent.isFile())
            .map((dirent) => dirent.name)
            .sort(byName);
        const sourceImages = files.filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
        const outputNames = sourceImages.map(getWebpName);

        if (new Set(outputNames).size !== outputNames.length) {
            throw new Error(`Multiple source images map to the same WebP file in: ${sourceWorkDir}`);
        }

        fs.mkdirSync(outputWorkDir, { recursive: true });
        for (let index = 0; index < sourceImages.length; index += 1) {
            const sourceName = sourceImages[index];
            const outputName = outputNames[index];
            const result = await convertToWebp(
                path.join(sourceWorkDir, sourceName),
                path.join(outputWorkDir, outputName)
            );
            console.log(
                `  - ${workName}/${sourceName} -> ${outputName} ` +
                    `(${formatBytes(result.before)} -> ${formatBytes(result.after)})`
            );
        }

        const caption = files
            .filter((file) => path.extname(file).toLowerCase() === NOTE_EXTENSION)
            .map((file) =>
                fs.readFileSync(path.join(sourceWorkDir, file), "utf8").replaceAll("\r\n", "\n").trimEnd()
            )
            .join("\n\n");

        works.push({
            slug: workName,
            title: workName,
            images: outputNames.map((file) => `photo/${workName}/${file}`),
            caption
        });
    }

    return works;
}

function writePhotoPage(root, distDir, manifestPayload) {
    const sourcePath = path.join(root, "photo.html");
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Required static file not found: ${sourcePath}`);
    }

    const version = crypto.createHash("md5").update(manifestPayload).digest("hex").slice(0, 8);
    const source = fs.readFileSync(sourcePath, "utf8");
    const output = source.replace(/photo\/manifest\.js(?:\?v=[^"']*)?/, `photo/manifest.js?v=${version}`);
    fs.writeFileSync(path.join(distDir, "photo.html"), output, "utf8");
    return version;
}

async function buildSite({ root = DEFAULT_ROOT } = {}) {
    const photoDir = path.join(root, "photo");
    const distDir = path.join(root, "dist");
    const outputPhotoDir = path.join(distDir, "photo");

    fs.rmSync(distDir, { force: true, recursive: true });
    fs.mkdirSync(outputPhotoDir, { recursive: true });
    copyStaticFiles(root, distDir);

    const works = await buildWorks(photoDir, outputPhotoDir);
    const manifestPayload = `window.PHOTO_WORKS = ${JSON.stringify(works, null, 4)};\n`;
    fs.writeFileSync(path.join(outputPhotoDir, "manifest.js"), manifestPayload, "utf8");
    const version = writePhotoPage(root, distDir, manifestPayload);

    console.log(`Photo build complete: ${works.length} work(s) written to dist/ (manifest v${version})`);
    return { distDir, version, works };
}

if (require.main === module) {
    buildSite().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { buildSite, convertToWebp, getWebpName };
