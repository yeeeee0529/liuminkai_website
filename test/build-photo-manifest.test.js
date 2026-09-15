const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const sharp = require("sharp");

const { buildSite } = require("../scripts/build-photo-manifest.js");

function checksum(filePath) {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("buildSite creates WebP deployment assets without modifying source photos", async (context) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yeeeee-photo-build-"));
    context.after(() => fs.rmSync(root, { force: true, recursive: true }));

    for (const fileName of ["contact.html", "icon.jpeg", "liuminkai.html"]) {
        fs.writeFileSync(path.join(root, fileName), fileName);
    }
    fs.writeFileSync(
        path.join(root, "photo.html"),
        '<script src="photo/manifest.js?v=old"></script>',
        "utf8"
    );
    const sourcePhotoPageChecksum = checksum(path.join(root, "photo.html"));

    const sourceWorkDir = path.join(root, "photo", "測試作品");
    fs.mkdirSync(sourceWorkDir, { recursive: true });
    const sourceManifestPath = path.join(root, "photo", "manifest.js");
    fs.writeFileSync(sourceManifestPath, "source manifest sentinel\n", "utf8");
    const sourceManifestChecksum = checksum(sourceManifestPath);
    fs.writeFileSync(path.join(sourceWorkDir, "info.txt"), "作品說明\n", "utf8");
    const sourceImagePath = path.join(sourceWorkDir, "sample.jpg");
    await sharp({
        create: { width: 8, height: 6, channels: 3, background: { r: 20, g: 40, b: 60 } }
    })
        .jpeg()
        .toFile(sourceImagePath);
    const sourceChecksum = checksum(sourceImagePath);

    const result = await buildSite({ root });
    const outputImagePath = path.join(root, "dist", "photo", "測試作品", "sample.webp");
    const outputManifestPath = path.join(root, "dist", "photo", "manifest.js");
    const outputManifest = fs.readFileSync(outputManifestPath, "utf8");
    const manifestContext = { window: {} };
    vm.runInNewContext(outputManifest, manifestContext);

    assert.equal(checksum(sourceImagePath), sourceChecksum);
    assert.equal(checksum(path.join(root, "photo.html")), sourcePhotoPageChecksum);
    assert.equal(checksum(sourceManifestPath), sourceManifestChecksum);
    assert.equal(fs.existsSync(path.join(sourceWorkDir, "sample.webp")), false);
    assert.equal(fs.existsSync(path.join(root, "dist", "photo", "測試作品", "sample.jpg")), false);
    assert.equal((await sharp(outputImagePath).metadata()).format, "webp");
    assert.equal(JSON.stringify(manifestContext.window.PHOTO_WORKS), JSON.stringify(result.works));
    assert.deepEqual(result.works[0].images, ["photo/測試作品/sample.webp"]);
    assert.match(outputManifest, /sample\.webp/);
    assert.doesNotMatch(outputManifest, /sample\.jpg/);
    assert.match(fs.readFileSync(path.join(root, "dist", "photo.html"), "utf8"), /manifest\.js\?v=[a-f0-9]{8}/);
    assert.equal(result.works[0].caption, "作品說明");
});
