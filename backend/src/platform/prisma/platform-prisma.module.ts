import { Global, Module } from '@nestjs/common';
import { PlatformPrismaService } from './platform-prisma.service.js';

/** The platform database for every platform module; global so they only inject PlatformPrismaService. */
@Global()
@Module({
  providers: [PlatformPrismaService],
  exports: [PlatformPrismaService],
})
export class PlatformPrismaModule {}
