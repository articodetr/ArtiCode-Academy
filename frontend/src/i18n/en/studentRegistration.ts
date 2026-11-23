// PORTAL-04 (#208) — English of ../ar/studentRegistration.ts.
import type { studentRegistration as arStudentRegistration } from '../ar/studentRegistration'

export const studentRegistration: typeof arStudentRegistration = {
  entry: {
    createAccount: 'Create account',
    noAccount: 'No account yet?',
    createAccountLink: 'Create one',
    accountsNote: 'You can create a student account yourself, or sign in with the one you have.',
    courseNote: 'Sign in or create an account to choose a class and confirm your enrollment.',
    courseAfterRegister: 'After you sign in, we take you back to the same course to choose a class and confirm your enrollment.',
  },
  register: {
    subtitle: 'Create a student account',
    intro: 'Enter your name and e-mail, and we will send you a message with the next step.',
    fullName: 'Full name',
    email: 'E-mail',
    submit: 'Continue',
    submitting: 'Sending…',
    haveAccount: 'Already have an account? Sign in',
    sentTitle: 'Check your e-mail',
    sentText: 'If the address is correct, you will receive a message with the next step. It may take a little while, so check your spam folder too.',
    goToSignIn: 'Go to sign in',
    anotherAddress: 'Enter another address',
  },
  closed: {
    title: 'Registration is not available right now',
    text: 'If you have an account, you can sign in with it.',
    signIn: 'Sign in',
  },
  complete: {
    subtitle: 'Finish creating your account',
    intro: 'Choose a password for your account. You can edit your name before continuing.',
    email: 'E-mail',
    fullName: 'Full name',
    submit: 'Create account',
    submitting: 'Creating your account…',
    loadFailed: 'The link could not be opened',
    retry: 'Try again',
    linkInvalid: 'This link is not valid or has already been used.',
    linkExpired: 'This link has expired. Register again with the same address to receive a new message.',
    registerAgain: 'Register again',
  },
  validation: {
    fullName: {
      required: 'Enter your full name.',
      blank: 'Enter your full name.',
      too_short: 'The name is too short: at least 2 characters.',
      too_long: 'The name is too long: at most 200 characters.',
      invalid_format: 'The name is not in a valid format.',
    },
    email: {
      required: 'Enter your e-mail.',
      blank: 'Enter your e-mail.',
      too_short: 'The e-mail is too short.',
      too_long: 'The e-mail is too long: at most 320 characters.',
      invalid_format: 'The e-mail is not in a valid format.',
    },
  },
  errors: {
    invalid: 'The details could not be accepted. Check them and try again.',
    rateLimited: 'Too many attempts in a short time. Wait a moment and try again.',
    rateLimitedSoon: 'Too many attempts in a short time. Try again in less than a minute.',
    rateLimitedMinutes: 'Too many attempts in a short time. Try again in {{count}} minutes.',
    rateLimitedMinutes_one: 'Too many attempts in a short time. Try again in 1 minute.',
    rateLimitedMinutes_two: 'Too many attempts in a short time. Try again in {{count}} minutes.',
    rateLimitedMinutes_few: 'Too many attempts in a short time. Try again in {{count}} minutes.',
    rateLimitedMinutes_many: 'Too many attempts in a short time. Try again in {{count}} minutes.',
    rateLimitedMinutes_other: 'Too many attempts in a short time. Try again in {{count}} minutes.',
  },
  notices: {
    accountCreated: 'Your account has been created. Sign in',
  },
}
