-- Stage 0 of the market-ready rendering plan: one SurfaceAnalysis contract per re-surfaceable
-- area, and a physical profile per material. Existing data is carried over before old columns go.

-- CreateTable
CREATE TABLE `Surface` (
    `id` VARCHAR(191) NOT NULL,
    `showcaseImageId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `maskUrl` VARCHAR(2048) NOT NULL,
    `occluderMaskUrl` VARCHAR(2048) NULL,
    `analysisVersion` VARCHAR(64) NOT NULL,
    `modelVersions` JSON NULL,
    `confidence` DOUBLE NOT NULL DEFAULT 0,
    `needsReview` BOOLEAN NOT NULL DEFAULT true,
    `plane` JSON NULL,
    `calibration` JSON NULL,
    `lightingMapUrl` VARCHAR(2048) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Surface_showcaseImageId_idx`(`showcaseImageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Surface` ADD CONSTRAINT `Surface_showcaseImageId_fkey` FOREIGN KEY (`showcaseImageId`) REFERENCES `ShowcaseImage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Hotspot: add the surface link, move saved masks/planes into Surface rows (flagged for review)
ALTER TABLE `Hotspot` ADD COLUMN `surfaceId` VARCHAR(191) NULL;

INSERT INTO `Surface` (`id`, `showcaseImageId`, `kind`, `label`, `maskUrl`, `analysisVersion`, `confidence`, `needsReview`, `plane`, `updatedAt`)
SELECT CONCAT('srf_', `id`), `showcaseImageId`, 'custom', `label`, `maskUrl`, 'legacy-segformer-1', 0, true,
       CASE WHEN `plane` IS NULL THEN NULL ELSE JSON_OBJECT('homographyFallback', `plane`) END,
       CURRENT_TIMESTAMP(3)
FROM `Hotspot` WHERE `maskUrl` IS NOT NULL;

UPDATE `Hotspot` SET `surfaceId` = CONCAT('srf_', `id`) WHERE `maskUrl` IS NOT NULL;

CREATE INDEX `Hotspot_surfaceId_idx` ON `Hotspot`(`surfaceId`);
ALTER TABLE `Hotspot` ADD CONSTRAINT `Hotspot_surfaceId_fkey` FOREIGN KEY (`surfaceId`) REFERENCES `Surface`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Hotspot` DROP COLUMN `maskUrl`, DROP COLUMN `plane`;

-- Material: physical profile, seeded from category defaults and any custom tileScale
ALTER TABLE `Material`
    ADD COLUMN `realWidthMm` DOUBLE NOT NULL DEFAULT 600,
    ADD COLUMN `realHeightMm` DOUBLE NULL,
    ADD COLUMN `repeatMode` VARCHAR(16) NOT NULL DEFAULT 'seamless',
    ADD COLUMN `orientationDeg` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `jointWidthMm` DOUBLE NULL,
    ADD COLUMN `jointColor` VARCHAR(16) NULL,
    ADD COLUMN `roughness` DOUBLE NOT NULL DEFAULT 0.5,
    ADD COLUMN `metallic` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `normalStrength` DOUBLE NOT NULL DEFAULT 0.3,
    ADD COLUMN `normalUrl` VARCHAR(2048) NULL,
    ADD COLUMN `roughnessUrl` VARCHAR(2048) NULL,
    ADD COLUMN `heightUrl` VARCHAR(2048) NULL;

UPDATE `Material` SET `repeatMode` = 'sheet', `realWidthMm` = 1220 * COALESCE(`tileScale`, 1), `realHeightMm` = 2440 * COALESCE(`tileScale`, 1), `jointWidthMm` = 3, `jointColor` = '#2a1e14' WHERE `category` = 'sheet';
UPDATE `Material` SET `repeatMode` = 'tile', `realWidthMm` = 600, `realHeightMm` = 600, `jointWidthMm` = 3, `jointColor` = '#d9d4cc' WHERE `category` = 'tile';
UPDATE `Material` SET `realWidthMm` = 600 * COALESCE(`tileScale`, 1) WHERE `category` NOT IN ('sheet', 'tile');
UPDATE `Material` SET `realWidthMm` = 1200 * COALESCE(`tileScale`, 1) WHERE `category` = 'stone';
UPDATE `Material` SET `metallic` = 0.8, `roughness` = 0.35 WHERE `category` = 'metal';
UPDATE `Material` SET `roughness` = 0.9 WHERE `category` IN ('carpet', 'fabric', 'plaster', 'paint');
UPDATE `Material` SET `roughness` = 0.15 WHERE LOWER(CONCAT(`finishType`, ' ', `description`)) REGEXP 'gloss|lacquer|mirror|polished';
UPDATE `Material` SET `roughness` = 0.35 WHERE LOWER(CONCAT(`finishType`, ' ', `description`)) REGEXP 'satin|silk|sheen' AND `category` <> 'metal';

ALTER TABLE `Material` DROP COLUMN `blendMode`, DROP COLUMN `renderOverlayTone`, DROP COLUMN `tileScale`;
