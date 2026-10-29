import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** Database access for every feature module; global so modules only inject PrismaService. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
