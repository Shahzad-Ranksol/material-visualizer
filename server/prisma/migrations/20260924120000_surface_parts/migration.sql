-- AlterTable
ALTER TABLE `Surface` ADD COLUMN `parentSurfaceId` VARCHAR(191) NULL;
-- AddForeignKey
ALTER TABLE `Surface` ADD CONSTRAINT `Surface_parentSurfaceId_fkey` FOREIGN KEY (`parentSurfaceId`) REFERENCES `Surface`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
