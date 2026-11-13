import { Module } from '@nestjs/common';
import { FleetCoreModule } from './fleet-core.module.js';
import { FleetController } from './fleet.controller.js';

/** MOD-18-T05 — API-196..198 (fleet health) of the platform API. */
@Module({
  imports: [FleetCoreModule],
  controllers: [FleetController],
})
export class FleetModule {}
