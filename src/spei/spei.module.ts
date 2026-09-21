import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpeiController } from './spei.controller';
import { SpeiService } from './spei.service';
import { SpeiPayment } from './entities/spei-payment.entity';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([SpeiPayment]), ProjectsModule],
  controllers: [SpeiController],
  providers: [SpeiService],
})
export class SpeiModule {}
