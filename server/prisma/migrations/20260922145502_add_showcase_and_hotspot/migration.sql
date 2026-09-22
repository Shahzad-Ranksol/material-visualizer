-- CreateTable
CREATE TABLE `ShowcaseImage` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(2048) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ShowcaseImage_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Hotspot` (
    `id` VARCHAR(191) NOT NULL,
    `showcaseImageId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `xPct` DOUBLE NOT NULL,
    `yPct` DOUBLE NOT NULL,
    `allowedCategories` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Hotspot_showcaseImageId_idx`(`showcaseImageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ShowcaseImage` ADD CONSTRAINT `ShowcaseImage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Hotspot` ADD CONSTRAINT `Hotspot_showcaseImageId_fkey` FOREIGN KEY (`showcaseImageId`) REFERENCES `ShowcaseImage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
