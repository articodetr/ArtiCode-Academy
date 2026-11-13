import { Global, Module } from '@nestjs/common';
import { PlatformAuditService } from './platform-audit.service.js';

/** Global so every platform module injects PlatformAuditService without importing this module. */
@Global()
@Module({
  providers: [PlatformAuditService],
  exports: [PlatformAuditService],
})
export class PlatformAuditModule {}
