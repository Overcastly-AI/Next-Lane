import { Module } from '@nestjs/common';
import { PageImagesController } from './page-images.controller';
import { PageImagesService } from './page-images.service';

@Module({
  controllers: [PageImagesController],
  providers: [PageImagesService],
  exports: [PageImagesService],
})
export class PageImagesModule {}
