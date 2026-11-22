// PORTAL-04 (#208): the public home page — English of ../ar/publicHome.ts (the same keys; the Arabic is the reference).
import type { publicHome as arPublicHome } from '../ar/publicHome'

export const publicHome: typeof arPublicHome = {
  meta: {
    descriptionNamed: '{{name}} — structured learning programs in levels and lessons that you follow step by step, with your progress in My School.',
    description: 'Structured learning programs in levels and lessons that you follow step by step, with your progress in My School.',
  },
  hero: {
    welcomeNamed: 'Welcome to {{name}}',
    welcome: 'Welcome',
    title: 'Learn in clear steps, and follow your progress as you go',
    subtitle: 'Structured programs in levels and lessons that you follow step by step, with your progress in My School.',
    browse: 'Browse programs',
    signIn: 'Sign in',
    accountsNote: 'Accounts are created by the academy.',
    mySchool: 'My School',
    dashboard: 'Dashboard',
  },
  programs: {
    title: 'Learning programs',
    subtitle: 'From the academy’s published programs: their overview, content and fees.',
    all: 'All programs',
    emptyTitle: 'No programs yet',
    empty: 'No program is published yet.',
    loadError: 'The programs could not be loaded.',
    retry: 'Try again',
    closedVisitor: {
      title: 'Programs are open to account holders',
      text: 'The academy does not show its programs to visitors. Sign in with your account to browse them.',
    },
    closedLearner: {
      title: 'Browse the courses from your account',
      text: 'The academy does not show its programs to visitors; the courses open to you are on the courses page.',
      action: 'Courses page',
    },
    closedStaff: {
      title: 'Public browsing is off',
      text: 'Visitors see none of the academy’s programs because browsing courses as a visitor is not enabled in the settings.',
      action: 'Settings',
    },
  },
  steps: {
    title: 'How do you start?',
    subtitle: 'Three steps from choosing a program to following your lessons.',
    choose: {
      title: 'Choose your program',
      text: 'Browse the programs and read each one’s overview, content and fees.',
    },
    signIn: {
      title: 'Sign in with your account',
      text: 'Accounts are created by the academy; sign in with the account it gives you.',
    },
    learn: {
      title: 'Enroll and start learning',
      text: 'Enroll in a class — at once for a free program, after payment and the academy’s approval for a paid one — then follow your lessons in My School.',
    },
  },
  cta: {
    visitorTitle: 'Ready to start?',
    visitorText: 'Choose the program that suits you, then sign in with your account to enroll.',
  },
}
