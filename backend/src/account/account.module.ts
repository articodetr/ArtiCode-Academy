import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MailModule } from '../mail/mail.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { EmailVerificationController } from './email-verification.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { PasswordResetController } from './password-reset.controller.js';
import { VerificationTokenService } from './verification-token.service.js';

/**
 * MOD-03-T03 — invitations and account activation; MOD-03-T05 — password
 * reset; LR-01-T02 — e-mail verification. Depends on AuthModule (password hashing, session issuance, the rate
 * limiter), MailModule (the e-mail copy behind the MailTransport abstraction),
 * and the global PrismaModule/AuditModule.
 */
@Module({
  imports: [AuthModule, MailModule],
  controllers: [
    AccountController,
    InvitationsController,
    PasswordResetController,
    EmailVerificationController,
  ],
  providers: [VerificationTokenService, AccountService],
  exports: [VerificationTokenService],
})
export class AccountModule {}
