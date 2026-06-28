import { Module } from '@nestjs/common';
import { PersonalBoardsController } from './personal-boards.controller';
import { PersonalBoardsService } from './personal-boards.service';
import { IssuesModule } from '../issues/issues.module';

@Module({
  imports: [IssuesModule],
  controllers: [PersonalBoardsController],
  providers: [PersonalBoardsService],
})
export class PersonalBoardsModule {}
